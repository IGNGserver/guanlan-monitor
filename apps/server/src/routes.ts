import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AgentCloudConfigSyncPayload,
  AuthLoginPayload,
  DeviceMetricOption,
  DeviceMetricConfigPayload,
  DeviceMetricKey,
  FanNotePayload,
  MetricSeries,
  MetricWindow,
  ReleaseChannel,
  SamplePoint,
  TrafficCalendarMode,
  WidgetLayoutSaveRequest
} from "@dsc/shared";
import { z } from "zod";
import { env } from "./config.js";
import type { MetricsService } from "./services/metrics.js";
import { unavailableMetricsForVirtualMachinePowerState } from "./services/virtual-machines.js";
import { LocalDeviceMetricConfigStore, LocalFanNoteStore, LocalWidgetLayoutStore, createLocalStore } from "./repositories/local.js";
import type { Repositories, SessionValue } from "./types.js";
import { ALL_DEVICE_METRIC_KEYS, filterAgentPayloadInstances, getAvailableMetrics, resolveCpuFrequencyMHz, resolveCpuTemperatureC, timeSeriesToMetricSeries, toDetail, toSummary } from "./utils.js";
import { virtualizationStorageInstances } from "@dsc/shared";
import { getSystemVersionInfo, getUpdateInfo } from "./updates.js";
import { getHubUpdateStatus, HubUpdateError, requestHubUpdate } from "./hub-update.js";

const loginSchema = z.object({
  accessKey: z.string()
});

const metricsQuerySchema = z.object({
  window: z.enum(["1m", "5m", "15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"]).default("5m")
});

const trafficCalendarSchema = z.object({
  mode: z.enum(["day", "week", "month"]).default("day"),
  anchor: z.string().default(() => new Date().toISOString()),
  selectedStart: z.string().optional()
});

const fanNoteSchema = z.object({
  note: z.string().max(100)
});

const metricConfigSchema = z.object({
  enabledMetrics: z.array(
    z.enum([
      "cpuUsage",
      "cpuFrequency",
      "cpuTemperature",
      "cpuTopology",
      "systemOverview",
      "gpuUsage",
      "gpuEncode",
      "gpuDecode",
      "gpuFrequency",
      "gpuMemory",
      "gpuTemperature",
      "gpuDriverInfo",
      "temperatureSources",
      "memoryUsage",
      "swapUsage",
      "memoryAvailable",
      "memoryCached",
      "memoryCommitted",
      "memoryHardware",
      "diskUsage",
      "diskRead",
      "diskWrite",
      "diskMetadata",
      "diskActivity",
      "diskHealth",
      "networkRxRate",
      "networkTxRate",
      "networkTraffic",
      "networkIdentity",
      "fanRpm",
      "fanControl",
      "fanTargetTemperature",
      "fanPwm",
      "fanChannelState",
      "fanNote"
    ] satisfies [DeviceMetricKey, ...DeviceMetricKey[]])
  ),
  enabledDeviceIds: z.record(z.string(), z.array(z.string())).optional(),
  instanceMetricConfig: z.record(
    z.string(),
    z.array(
      z.enum([
        "cpuUsage",
        "cpuFrequency",
        "cpuTemperature",
        "cpuTopology",
        "systemOverview",
        "gpuUsage",
        "gpuEncode",
        "gpuDecode",
        "gpuFrequency",
        "gpuMemory",
        "gpuTemperature",
        "gpuDriverInfo",
        "temperatureSources",
        "memoryUsage",
        "swapUsage",
        "memoryAvailable",
        "memoryCached",
        "memoryCommitted",
        "memoryHardware",
        "diskUsage",
        "diskRead",
        "diskWrite",
        "diskMetadata",
        "diskActivity",
        "diskHealth",
        "networkRxRate",
        "networkTxRate",
        "networkTraffic",
        "networkIdentity",
        "fanRpm",
        "fanControl",
        "fanTargetTemperature",
        "fanPwm",
        "fanChannelState",
        "fanNote"
      ] satisfies [DeviceMetricKey, ...DeviceMetricKey[]])
    )
  ).optional()
});

const METRIC_WINDOW_DURATION_MS: Record<MetricWindow, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "90d": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000
};

const widgetLayoutPlacementSchema = z.object({
  x: z.number().int().min(1).max(12),
  y: z.number().int().min(1),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1),
  size: z.enum(["large", "medium", "small"]),
  hidden: z.boolean().optional()
});

const widgetInstanceConfigSchema = z.record(z.string().max(80), z.union([
  z.string().max(240),
  z.number().finite(),
  z.boolean(),
  z.null()
])).optional();

const widgetPanelMetadataSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(80),
  kind: z.enum(["system", "custom"]),
  order: z.number().int().min(0).max(1000)
});

const widgetLayoutDocumentSchema = z.object({
  version: z.number().int().min(1).max(10).optional(),
  placements: z.record(z.string().min(1).max(160), widgetLayoutPlacementSchema),
  catalog: z.record(z.string().min(1).max(160), z.object({
    title: z.string().min(1).max(200),
    kind: z.enum(["group", "content"]),
    defaultSize: z.enum(["large", "medium", "small"]),
    templateId: z.string().min(1).max(160).optional(),
    groupId: z.string().min(1).max(160).optional(),
    widgetType: z.string().min(1).max(120).optional(),
    category: z.string().min(1).max(80).optional(),
    visualization: z.enum(["line", "area", "bar", "donut", "number", "table"]).optional(),
    config: widgetInstanceConfigSchema
  })),
  snapToGrid: z.boolean(),
  panels: z.array(widgetPanelMetadataSchema).max(32).optional()
});

const widgetLayoutQuerySchema = z.object({
  scopeKey: z.string().trim().min(1).max(240),
  templateKey: z.string().trim().min(1).max(240)
});

const widgetLayoutSaveSchema = z.object({
  scopeKey: z.string().trim().min(1).max(240),
  templateKey: z.string().trim().min(1).max(240),
  instanceLayout: widgetLayoutDocumentSchema.nullable().optional(),
  template: z.object({
    id: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().min(1).max(80),
    layout: widgetLayoutDocumentSchema
  }).optional(),
  deleteTemplateId: z.string().trim().min(1).max(160).optional()
});

const updateQuerySchema = z.object({
  platform: z.enum([
    "hub",
    "web",
    "windows-gui",
    "linux-gui",
    "android",
    "ios",
    "windows-cli",
    "linux-cli"
  ]),
  currentVersion: z.string().trim().min(1).optional(),
  currentChannel: z.enum(["stable", "test"]).optional(),
  arch: z.string().trim().min(1).optional()
});

const hubUpdateRequestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/)
});

export async function registerRoutes(
  app: FastifyInstance,
  repositories: Repositories,
  metricsService: MetricsService,
) {
  const store = createLocalStore();
  const fanNotes = new LocalFanNoteStore(store);
  const metricConfigs = new LocalDeviceMetricConfigStore(store);
  const widgetLayouts = new LocalWidgetLayoutStore(store);

  app.get("/api/system/version", async () => getSystemVersionInfo());

  app.get<{ Querystring: { platform: string; currentVersion?: string; currentChannel?: ReleaseChannel; arch?: string } }>(
    "/api/updates",
    async (request, reply) => {
      const parsed = updateQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_update_query" });
      }
      try {
        return await getUpdateInfo(parsed.data);
      } catch (error) {
        request.log.error({ error }, "update check failed");
        return reply.code(502).send({ error: "update_check_failed" });
      }
    }
  );

  app.get("/api/admin/hub-update-status", { preHandler: requireAuth }, async () => getHubUpdateStatus());

  app.post("/api/admin/hub-update", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = hubUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_hub_update_request" });
    try {
      return await requestHubUpdate(parsed.data.version);
    } catch (error) {
      if (error instanceof HubUpdateError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      request.log.error({ error }, "hub update request failed");
      return reply.code(502).send({ error: "hub_update_request_failed" });
    }
  });

  app.post<{ Body: AuthLoginPayload }>("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_login_payload" });
    }
    const body = parsed.data;
    if (body.accessKey !== env.ACCESS_KEY) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    setSession(reply, {
      issuedAt: new Date().toISOString()
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("dsc_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/session", async (request, reply) => {
    const session = getSession(request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { ok: true, issuedAt: session.issuedAt };
  });

  app.get<{ Querystring: { scopeKey: string; templateKey: string } }>("/api/widget-layouts", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = widgetLayoutQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_widget_layout_query" });
    return widgetLayouts.get(parsed.data.scopeKey, parsed.data.templateKey);
  });

  app.put<{ Body: WidgetLayoutSaveRequest }>("/api/widget-layouts", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = widgetLayoutSaveSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_widget_layout_payload" });
    return widgetLayouts.save(parsed.data as WidgetLayoutSaveRequest);
  });

  const deviceReorderSchema = z.object({
    deviceIds: z.array(z.string())
  });

  app.get("/api/devices", { preHandler: requireAuth }, async () => {
    return buildDeviceSummaries(repositories);
  });

  app.get("/api/virtual-machines", { preHandler: requireAuth }, async () => {
    return buildVirtualMachineSummaries(repositories);
  });

  app.get("/api/instances", { preHandler: requireAuth }, async () => {
    const [devices, virtualMachines] = await Promise.all([
      buildDeviceSummaries(repositories),
      buildVirtualMachineSummaries(repositories)
    ]);
    return [...devices, ...virtualMachines];
  });

  app.get<{ Querystring: { window: MetricWindow } }>(
    "/api/overview/metrics",
    { preHandler: requireAuth },
    async (request) => {
      const query = metricsQuerySchema.parse(request.query);
      const states = await repositories.realtime.listDevices();
      const instances = await Promise.all(
        states.map(async (state) => {
          const series = sanitizeUnsupportedMetricSeries(
            alignMetricSeriesToWindow(
              timeSeriesToMetricSeries(
                await metricsService.getSeries(state.identity.deviceId, query.window),
                await metricsService.getMetricConfig(state.identity.deviceId)
              ),
              query.window
            ),
            getAvailableMetrics(state)
          );
          return {
            deviceId: state.identity.deviceId,
            hostname: toSummary(state).hostname,
            instanceType: state.identity.instanceType ?? "device",
            cpuUsagePercent: series.cpuUsagePercent,
            memoryUsedBytes: series.memoryUsedBytes,
            diskUsedBytes: series.diskUsedBytes,
            networkRxBytesPerSec: series.networkRxBytesPerSec,
            networkTxBytesPerSec: series.networkTxBytesPerSec,
            unavailableMetrics: state.latest.unavailableMetrics ?? []
          };
        })
      );
      return { window: query.window, instances };
    }
  );

  app.delete<{ Params: { deviceId: string } }>("/api/devices/:deviceId", { preHandler: requireAuth }, async (request, reply) => {
    const { deviceId } = request.params;
    if (isVirtualMachineId(deviceId)) {
      await repositories.virtualMachines.delete(deviceId);
    } else {
      await repositories.devices.deleteDevice(deviceId);
    }
    return { ok: true };
  });

  app.put("/api/devices/reorder", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = deviceReorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_reorder_payload" });
    }
    const virtualMachineIds = parsed.data.deviceIds.filter(isVirtualMachineId);
    const deviceIds = parsed.data.deviceIds.filter((id) => !isVirtualMachineId(id));
    await Promise.all([
      repositories.devices.reorderDevices(deviceIds),
      repositories.virtualMachines.reorder(virtualMachineIds)
    ]);
    return { ok: true };
  });

  app.get<{ Params: { deviceId: string } }>("/api/devices/:deviceId", { preHandler: requireAuth }, async (request, reply) => {
    const state = await repositories.realtime.getDevice(request.params.deviceId);
    if (!state) return reply.code(404).send({ error: "device_not_found" });
    return toDetail(state);
  });

  app.get<{ Params: { deviceId: string }; Querystring: { window: MetricWindow } }>(
    "/api/devices/:deviceId/metrics",
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = metricsQuerySchema.parse(request.query);
      const state = await repositories.realtime.getDevice(request.params.deviceId);
      if (!state) return reply.code(404).send({ error: "device_not_found" });
      const notes = await fanNotes.get(request.params.deviceId);
      const baseAvailableMetrics = getAvailableMetrics(state);
      const metricConfig = await metricsService.getMetricConfig(request.params.deviceId);
      const enabledMetrics = metricConfig.enabledMetrics;
      const latest = filterAgentPayloadInstances(state.latest, metricConfig);

      const series = sanitizeUnsupportedMetricSeries(
        alignMetricSeriesToWindow(
          timeSeriesToMetricSeries(
            await metricsService.getSeries(request.params.deviceId, query.window),
            metricConfig
          ),
          query.window
        ),
        baseAvailableMetrics
      );
      const availableMetrics = markSeriesBackedMetricAvailability(baseAvailableMetrics, series);
      const rangeEnd = new Date();
      const rangeStart = new Date(rangeEnd.getTime() - METRIC_WINDOW_DURATION_MS[query.window]);
      return {
        device: toDetail(state),
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        window: query.window,
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        enabledMetrics,
        enabledDeviceIds: metricConfig.enabledDeviceIds ?? {},
        instanceMetricConfig: metricConfig.instanceMetricConfig ?? {},
        availableMetrics,
        latest: {
          system: state.latest.system,
          cpuUsagePercent: state.latest.cpuUsagePercent,
          cpuFrequencyMHz: resolveCpuFrequencyMHz(latest),
          cpuTemperatureC: resolveCpuTemperatureC(latest),
          cpuPackages: latest.cpuPackages ?? [],
          memoryUsedBytes: latest.memory.usedBytes,
          memoryTotalBytes: latest.memory.totalBytes,
          memoryAvailableBytes: latest.memory.availableBytes,
          memoryCachedBytes: latest.memory.cachedBytes,
          memoryCommittedBytes: latest.memory.committedBytes,
          memoryCommitLimitBytes: latest.memory.commitLimitBytes,
          memorySpeedMHz: latest.memory.speedMHz ?? null,
          memorySlotCount: latest.memory.slotCount ?? null,
          memoryFormFactor: latest.memory.formFactor ?? null,
          swapUsedBytes: latest.memory.swapUsedBytes,
          swapTotalBytes: latest.memory.swapTotalBytes,
          diskUsedBytes: latest.diskUsage.usedBytes,
          diskTotalBytes: latest.diskUsage.totalBytes,
          networkRxBytesPerSec: latest.networkRate.rxBytesPerSec,
          networkTxBytesPerSec: latest.networkRate.txBytesPerSec,
          disks: latest.disks ?? [],
          networkInterfaces: latest.networkInterfaces ?? [],
          gpus: latest.gpus,
          temperatureSensors: latest.temperatureSensors ?? [],
          sensorBackends: latest.sensorBackends ?? [],
          virtualization: latest.virtualization ?? null,
          storagePools: virtualizationStorageInstances(latest.virtualization),
          unavailableMetrics: latest.unavailableMetrics ?? [],
          fans: (latest.fans ?? []).map((fan) => ({
            ...fan,
            note: notes[fan.id] ?? fan.note ?? ""
          }))
        },
        series
      };
    }
  );

  app.get<{ Params: { deviceId: string }; Querystring: { mode: TrafficCalendarMode; anchor: string; selectedStart?: string } }>(
    "/api/devices/:deviceId/traffic-calendar",
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = trafficCalendarSchema.parse(request.query);
      const state = await repositories.realtime.getDevice(request.params.deviceId);
      if (!state) return reply.code(404).send({ error: "device_not_found" });
      return metricsService.getTrafficCalendar(
        request.params.deviceId,
        query.mode,
        query.anchor,
        query.selectedStart
      );
    }
  );

  app.put<{ Params: { deviceId: string; fanId: string }; Body: FanNotePayload }>(
    "/api/devices/:deviceId/fans/:fanId/note",
    { preHandler: requireAuth },
    async (request) => {
      const body = fanNoteSchema.parse(request.body);
      await fanNotes.set(request.params.deviceId, request.params.fanId, body.note);
      return { ok: true, deviceId: request.params.deviceId, fanId: request.params.fanId, note: body.note };
    }
  );

  app.get<{ Params: { deviceId: string } }>("/api/devices/:deviceId/metric-config", { preHandler: requireAuth }, async (request, reply) => {
    const state = await repositories.realtime.getDevice(request.params.deviceId);
    if (!state) return reply.code(404).send({ error: "device_not_found" });
    const config = await metricConfigs.get(request.params.deviceId);
    return {
      deviceId: request.params.deviceId,
      availableMetrics: getAvailableMetrics(state),
      enabledMetrics: config?.enabledMetrics ?? ALL_DEVICE_METRIC_KEYS,
      enabledDeviceIds: config?.enabledDeviceIds ?? {},
      instanceMetricConfig: config?.instanceMetricConfig ?? {}
    };
  });

  app.put<{ Params: { deviceId: string }; Body: DeviceMetricConfigPayload }>(
    "/api/devices/:deviceId/metric-config",
    { preHandler: requireAuth },
    async (request, reply) => {
      const state = await repositories.realtime.getDevice(request.params.deviceId);
      if (!state) return reply.code(404).send({ error: "device_not_found" });
      const body = metricConfigSchema.parse(request.body);
      await metricsService.setEnabledMetrics(request.params.deviceId, {
        enabledMetrics: body.enabledMetrics,
        enabledDeviceIds: body.enabledDeviceIds ?? {},
        instanceMetricConfig: body.instanceMetricConfig ?? {}
      });
      return {
        deviceId: request.params.deviceId,
        availableMetrics: getAvailableMetrics(state),
        enabledMetrics: body.enabledMetrics,
        enabledDeviceIds: body.enabledDeviceIds ?? {},
        instanceMetricConfig: body.instanceMetricConfig ?? {}
      };
    }
  );

  app.post<{ Body: AgentCloudConfigSyncPayload }>("/api/agent/device-config", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.ACCESS_KEY) {
      return reply.code(401).send({ error: "unauthorized_agent" });
    }

    const body = metricConfigSchema.extend({
      deviceId: z.string().min(1)
    }).parse(request.body);

    await metricsService.setEnabledMetrics(body.deviceId, {
      enabledMetrics: body.enabledMetrics,
      enabledDeviceIds: body.enabledDeviceIds ?? {},
      instanceMetricConfig: body.instanceMetricConfig ?? {}
    });

    const state = await repositories.realtime.getDevice(body.deviceId);
    return {
      deviceId: body.deviceId,
      availableMetrics: state ? getAvailableMetrics(state) : [],
      enabledMetrics: body.enabledMetrics,
      enabledDeviceIds: body.enabledDeviceIds ?? {},
      instanceMetricConfig: body.instanceMetricConfig ?? {}
    };
  });

  app.get("/api/agent/ping", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.ACCESS_KEY) {
      return reply.code(401).send({ error: "unauthorized_agent" });
    }

    return {
      ok: true,
      serverTime: new Date().toISOString()
    };
  });

  app.get<{ Querystring: { deviceId: string } }>("/api/agent/device-state", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.ACCESS_KEY) {
      return reply.code(401).send({ error: "unauthorized_agent" });
    }

    const deviceId = z.string().min(1).parse(request.query.deviceId);
    const state = await repositories.realtime.getDevice(deviceId);
    if (!state) {
      return reply.code(404).send({ error: "device_not_found" });
    }

    return {
      deviceId,
      status: state.status,
      lastSeenAt: state.lastSeenAt,
      latest: state.latest
    };
  });

}

function isVirtualMachineId(deviceId: string): boolean {
  return deviceId.startsWith("vm:");
}

async function buildDeviceSummaries(repositories: Repositories) {
  const openDevices = await repositories.devices.listOpenDevices();
  const realtimeDevices = (await repositories.realtime.listDevices()).filter(
    (state) => state.identity.instanceType !== "virtual_machine"
  );
  const realtimeMap = new Map(realtimeDevices.map((state) => [state.identity.deviceId, state]));
  const knownDevices = (await repositories.history.listKnownDevices()).filter((known) => !isVirtualMachineId(known.deviceId));
  const registeredIds = new Set(openDevices.map((device) => device.deviceId));

  for (const realtimeState of realtimeDevices) {
    if (!registeredIds.has(realtimeState.identity.deviceId)) {
      const record = await repositories.devices.registerOrUpdateDevice(
        realtimeState.identity.deviceId,
        realtimeState.identity.hostname
      );
      if (record.status === "open") {
        openDevices.push(record);
        registeredIds.add(record.deviceId);
      }
    }
  }

  for (const known of knownDevices) {
    if (!registeredIds.has(known.deviceId)) {
      const record = await repositories.devices.registerOrUpdateDevice(known.deviceId, known.deviceId);
      if (record.status === "open") {
        openDevices.push(record);
        registeredIds.add(record.deviceId);
      }
    }
  }

  return openDevices.map((record) => {
    const realtimeState = realtimeMap.get(record.deviceId);
    if (realtimeState) {
      return { ...toSummary(realtimeState), sortOrder: record.sortOrder };
    }
    return {
      deviceId: record.deviceId,
      hostname: record.name || record.deviceId,
      os: "unknown" as const,
      agentVersion: null,
      agentChannel: null,
      status: "offline" as const,
      lastSeenAt: record.updatedAt,
      cpuUsagePercent: null,
      gpuUsagePercent: null,
      gpuMemoryUsagePercent: null,
      memoryUsagePercent: null,
      diskUsagePercent: null,
      sortOrder: record.sortOrder,
      instanceType: "device" as const,
      hostName: null,
      virtualMachine: null
    };
  }).sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.deviceId.localeCompare(b.deviceId));
}

async function buildVirtualMachineSummaries(repositories: Repositories) {
  const records = await repositories.virtualMachines.listOpen();
  const realtimeStates = (await repositories.realtime.listDevices()).filter(
    (state) => state.identity.instanceType === "virtual_machine"
  );
  const realtimeMap = new Map(realtimeStates.map((state) => [state.identity.deviceId, state]));

  return records.map((record) => {
    const realtimeState = realtimeMap.get(record.virtualMachineId);
    if (realtimeState) {
      return { ...toSummary(realtimeState), sortOrder: record.sortOrder };
    }
    return {
      deviceId: record.virtualMachineId,
      hostname: record.name,
      os: "unknown" as const,
      agentVersion: null,
      agentChannel: null,
      status: "offline" as const,
      lastSeenAt: record.lastSeenAt,
      cpuUsagePercent: null,
      gpuUsagePercent: null,
      gpuMemoryUsagePercent: null,
      memoryUsagePercent: null,
      diskUsagePercent: null,
      sortOrder: record.sortOrder,
      instanceType: "virtual_machine" as const,
      hostName: record.hostName,
      virtualMachine: {
        vmId: record.virtualMachineId,
        externalId: record.externalId,
        platform: record.platform,
        node: record.node,
        type: record.type,
        powerState: record.powerState,
        hostDeviceId: record.hostDeviceId,
        hostName: record.hostName
      },
      unavailableMetrics: unavailableMetricsForVirtualMachinePowerState(record.powerState)
    };
  }).sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.deviceId.localeCompare(b.deviceId));
}

function rejectInsecureAgentTransport(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.AGENT_REQUIRE_HTTPS) {
    return false;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (request.protocol === "https" || protocol?.split(",")[0]?.trim().toLowerCase() === "https") {
    return false;
  }

  reply.code(400).send({ error: "https_required", message: "Agent endpoint requires HTTPS when AGENT_REQUIRE_HTTPS=true." });
  return true;
}

function sanitizeUnsupportedMetricSeries(series: MetricSeries, availableMetrics: DeviceMetricOption[]) {
  const available = new Map(availableMetrics.map((item) => [item.key, item.available]));
  let sanitized = series;
  if (available.get("temperatureSources") === false) {
    sanitized = {
      ...sanitized,
      temperatureSensors: []
    };
  }
  if (available.get("cpuTemperature") === false && !hasCpuTemperatureSeries(sanitized)) {
    sanitized = {
      ...sanitized,
      cpuTemperatureC: [],
      cpus: sanitized.cpus.map((cpu) => ({
        ...cpu,
        temperatureC: []
      }))
    };
  }
  return sanitized;
}

function hasMetricSeries(points: SamplePoint[] | undefined): boolean {
  return (points ?? []).some((point) => Number.isFinite(point.value) && point.value > 0);
}

function hasCpuTemperatureSeries(series: MetricSeries): boolean {
  return hasMetricSeries(series.cpuTemperatureC) || series.cpus.some((cpu) => hasMetricSeries(cpu.temperatureC));
}

function markSeriesBackedMetricAvailability(availableMetrics: DeviceMetricOption[], series: MetricSeries): DeviceMetricOption[] {
  const hasTemperatureSeries = series.temperatureSensors.some((sensor) => sensor.currentC.some((point) => point.value > 0));
  if (!hasCpuTemperatureSeries(series) && !hasTemperatureSeries) {
    return availableMetrics;
  }
  return availableMetrics.map((item) => {
    if (item.key === "cpuTemperature" && hasCpuTemperatureSeries(series)) return { ...item, available: true };
    if (item.key === "temperatureSources" && hasTemperatureSeries) return { ...item, available: true };
    return item;
  });
}

function alignMetricSeriesToWindow(series: MetricSeries, window: MetricWindow) {
  const bucketMs =
    window === "15m" || window === "1h" || window === "6h" || window === "24h" || window === "1d" ? 60_000 :
    window === "7d" || window === "1w" || window === "30d" || window === "1mo" || window === "90d" || window === "1y" ? 3_600_000 :
    0;
  if (!bucketMs) return series;

  return {
    ...series,
    cpuUsagePercent: alignSamplePoints(series.cpuUsagePercent, bucketMs),
    cpuFrequencyMHz: alignSamplePoints(series.cpuFrequencyMHz, bucketMs),
    cpuTemperatureC: alignSamplePoints(series.cpuTemperatureC, bucketMs),
    gpuUsagePercent: alignSamplePoints(series.gpuUsagePercent, bucketMs),
    gpuEncodePercent: alignSamplePoints(series.gpuEncodePercent, bucketMs),
    gpuDecodePercent: alignSamplePoints(series.gpuDecodePercent, bucketMs),
    gpuFrequencyMHz: alignSamplePoints(series.gpuFrequencyMHz, bucketMs),
    gpuMemoryUsagePercent: alignSamplePoints(series.gpuMemoryUsagePercent, bucketMs),
    gpuMemoryUsedBytes: alignSamplePoints(series.gpuMemoryUsedBytes, bucketMs),
    gpuTemperatureC: alignSamplePoints(series.gpuTemperatureC, bucketMs),
    memoryUsagePercent: alignSamplePoints(series.memoryUsagePercent, bucketMs),
    swapUsagePercent: alignSamplePoints(series.swapUsagePercent, bucketMs),
    memoryUsedBytes: alignSamplePoints(series.memoryUsedBytes, bucketMs),
    swapUsedBytes: alignSamplePoints(series.swapUsedBytes, bucketMs),
    memoryAvailableBytes: alignSamplePoints(series.memoryAvailableBytes, bucketMs),
    memoryCachedBytes: alignSamplePoints(series.memoryCachedBytes, bucketMs),
    memoryCommittedBytes: alignSamplePoints(series.memoryCommittedBytes, bucketMs),
    memoryCommitLimitBytes: alignSamplePoints(series.memoryCommitLimitBytes, bucketMs),
    systemProcessCount: alignSamplePoints(series.systemProcessCount, bucketMs),
    systemThreadCount: alignSamplePoints(series.systemThreadCount, bucketMs),
    systemHandleCount: alignSamplePoints(series.systemHandleCount, bucketMs),
    diskUsagePercent: alignSamplePoints(series.diskUsagePercent, bucketMs),
    diskUsedBytes: alignSamplePoints(series.diskUsedBytes, bucketMs),
    diskReadBytesPerSec: alignSamplePoints(series.diskReadBytesPerSec, bucketMs),
    diskWriteBytesPerSec: alignSamplePoints(series.diskWriteBytesPerSec, bucketMs),
    networkRxBytesPerSec: alignSamplePoints(series.networkRxBytesPerSec, bucketMs),
    networkTxBytesPerSec: alignSamplePoints(series.networkTxBytesPerSec, bucketMs),
    trafficRxBytes: alignSamplePoints(series.trafficRxBytes, bucketMs),
    trafficTxBytes: alignSamplePoints(series.trafficTxBytes, bucketMs),
    cpus: series.cpus.map((cpu) => ({
      ...cpu,
      usagePercent: alignSamplePoints(cpu.usagePercent, bucketMs),
      frequencyMHz: alignSamplePoints(cpu.frequencyMHz, bucketMs),
      temperatureC: alignSamplePoints(cpu.temperatureC, bucketMs)
    })),
    disks: series.disks.map((disk) => ({
      ...disk,
      totalBytes: alignSamplePoints(disk.totalBytes, bucketMs),
      usagePercent: alignSamplePoints(disk.usagePercent, bucketMs),
      activePercent: alignSamplePoints(disk.activePercent, bucketMs),
      usedBytes: alignSamplePoints(disk.usedBytes, bucketMs),
      readBytesPerSec: alignSamplePoints(disk.readBytesPerSec, bucketMs),
      writeBytesPerSec: alignSamplePoints(disk.writeBytesPerSec, bucketMs),
      temperatureC: alignSamplePoints(disk.temperatureC, bucketMs)
    })),
    storagePools: (series.storagePools ?? []).map((storage) => ({
      ...storage,
      totalBytes: alignSamplePoints(storage.totalBytes, bucketMs),
      usedBytes: alignSamplePoints(storage.usedBytes, bucketMs),
      availableBytes: alignSamplePoints(storage.availableBytes, bucketMs),
      usagePercent: alignSamplePoints(storage.usagePercent, bucketMs)
    })),
    networks: series.networks.map((network) => ({
      ...network,
      rxBytesPerSec: alignSamplePoints(network.rxBytesPerSec, bucketMs),
      txBytesPerSec: alignSamplePoints(network.txBytesPerSec, bucketMs),
      trafficRxBytes: alignSamplePoints(network.trafficRxBytes, bucketMs),
      trafficTxBytes: alignSamplePoints(network.trafficTxBytes, bucketMs)
    })),
    gpus: series.gpus.map((gpu) => ({
      ...gpu,
      usagePercent: alignSamplePoints(gpu.usagePercent, bucketMs),
      encodePercent: alignSamplePoints(gpu.encodePercent, bucketMs),
      decodePercent: alignSamplePoints(gpu.decodePercent, bucketMs),
      frequencyMHz: alignSamplePoints(gpu.frequencyMHz, bucketMs),
      memoryUsagePercent: alignSamplePoints(gpu.memoryUsagePercent, bucketMs),
      memoryUsedBytes: alignSamplePoints(gpu.memoryUsedBytes, bucketMs),
      temperatureC: alignSamplePoints(gpu.temperatureC, bucketMs)
    })),
    temperatureSensors: series.temperatureSensors.map((sensor) => ({
      ...sensor,
      currentC: alignSamplePoints(sensor.currentC, bucketMs)
    })),
    fans: series.fans.map((fan) => ({
      ...fan,
      rpm: alignSamplePoints(fan.rpm, bucketMs)
    }))
  };
}

function alignSamplePoints(points: Array<{ timestamp: string; value: number }>, bucketMs: number) {
  const deduped = new Map<number, { timestamp: string; value: number }>();
  for (const point of points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time)) continue;
    const alignedTime = Math.floor(time / bucketMs) * bucketMs;
    deduped.set(alignedTime, {
      timestamp: new Date(alignedTime).toISOString(),
      value: point.value
    });
  }
  return [...deduped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, point]) => point);
}

function setSession(reply: FastifyReply, session: SessionValue) {
  reply.setCookie("dsc_session", Buffer.from(JSON.stringify(session)).toString("base64url"), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.SESSION_COOKIE_SECURE,
    signed: true
  });
}

function getSession(request: FastifyRequest): SessionValue | null {
  const raw = request.cookies.dsc_session;
  if (!raw) return null;
  try {
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid) return null;
    return JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as SessionValue;
  } catch {
    return null;
  }
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const session = getSession(request);
  if (!session) return reply.code(401).send({ error: "unauthorized" });
}
