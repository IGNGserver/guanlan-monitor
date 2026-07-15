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
  TrafficCalendarMode
} from "@dsc/shared";
import { z } from "zod";
import { env } from "./config.js";
import type { MetricsService } from "./services/metrics.js";
import type { AgentControlService } from "./services/agent-control.js";
import type { ViewerPresenceService } from "./services/viewer-presence.js";
import { LocalDeviceMetricConfigStore, LocalFanNoteStore, createLocalStore } from "./repositories/local.js";
import type { Repositories, SessionValue } from "./types.js";
import { ALL_DEVICE_METRIC_KEYS, getAvailableMetrics, resolveCpuFrequencyMHz, timeSeriesToMetricSeries, toDetail, toSummary } from "./utils.js";

const loginSchema = z.object({
  accessKey: z.string()
});

const metricsQuerySchema = z.object({
  window: z.enum(["1m", "15m", "1d", "1w", "1mo", "1y"]).default("1m")
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
      "gpuUsage",
      "gpuEncode",
      "gpuDecode",
      "gpuFrequency",
      "gpuMemory",
      "gpuTemperature",
      "memoryUsage",
      "swapUsage",
      "diskUsage",
      "diskRead",
      "diskWrite",
      "networkRxRate",
      "networkTxRate",
      "networkTraffic"
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
        "gpuUsage",
        "gpuEncode",
        "gpuDecode",
        "gpuFrequency",
        "gpuMemory",
        "gpuTemperature",
        "memoryUsage",
        "swapUsage",
        "diskUsage",
        "diskRead",
        "diskWrite",
        "networkRxRate",
        "networkTxRate",
        "networkTraffic"
      ] satisfies [DeviceMetricKey, ...DeviceMetricKey[]])
    )
  ).optional()
});

const viewerPresenceSchema = z.object({
  viewerId: z.string().min(1),
  ttlSeconds: z.number().int().min(5).max(120).optional()
});

export async function registerRoutes(
  app: FastifyInstance,
  repositories: Repositories,
  metricsService: MetricsService,
  viewerPresence: ViewerPresenceService,
  agentControl: AgentControlService
) {
  const store = createLocalStore();
  const fanNotes = new LocalFanNoteStore(store);
  const metricConfigs = new LocalDeviceMetricConfigStore(store);
  app.post<{ Body: AuthLoginPayload }>("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_login_payload" });
    }
    const body = parsed.data;
    // The agent secret is also the viewer credential. ACCESS_KEY remains
    // accepted for existing web sessions during the migration.
    if (body.accessKey !== env.AGENT_SHARED_SECRET && body.accessKey !== env.ACCESS_KEY) {
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

  app.get("/api/devices", { preHandler: requireAuth }, async () => {
    const devices = await repositories.realtime.listDevices();
    return devices
      .map((state) => toSummary(state))
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
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
      const config = await metricConfigs.get(request.params.deviceId);
      const enabledMetrics = config?.enabledMetrics ?? ALL_DEVICE_METRIC_KEYS;

      const availableMetrics = getAvailableMetrics(state);
      const series = sanitizeUnsupportedMetricSeries(
        alignMetricSeriesToWindow(
          timeSeriesToMetricSeries(await metricsService.getSeries(request.params.deviceId, query.window)),
          query.window
        ),
        availableMetrics
      );
      return {
        device: toDetail(state),
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        enabledMetrics,
        enabledDeviceIds: config?.enabledDeviceIds ?? {},
        instanceMetricConfig: config?.instanceMetricConfig ?? {},
        availableMetrics,
        latest: {
          cpuUsagePercent: state.latest.cpuUsagePercent,
          cpuFrequencyMHz: resolveCpuFrequencyMHz(state.latest),
          cpuTemperatureC: state.latest.cpuTemperatureC ?? null,
          cpuPackages: state.latest.cpuPackages ?? [],
          memoryUsedBytes: state.latest.memory.usedBytes,
          memoryTotalBytes: state.latest.memory.totalBytes,
          swapUsedBytes: state.latest.memory.swapUsedBytes,
          swapTotalBytes: state.latest.memory.swapTotalBytes,
          diskUsedBytes: state.latest.diskUsage.usedBytes,
          diskTotalBytes: state.latest.diskUsage.totalBytes,
          networkRxBytesPerSec: state.latest.networkRate.rxBytesPerSec,
          networkTxBytesPerSec: state.latest.networkRate.txBytesPerSec,
          disks: state.latest.disks ?? [],
          networkInterfaces: state.latest.networkInterfaces ?? [],
          gpus: state.latest.gpus,
          sensorBackends: state.latest.sensorBackends ?? [],
          fans: (state.latest.fans ?? []).map((fan) => ({
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

  app.put<{ Params: { deviceId: string }; Body: { viewerId: string; ttlSeconds?: number } }>(
    "/api/devices/:deviceId/viewer-presence",
    { preHandler: requireAuth },
    async (request, reply) => {
      const state = await repositories.realtime.getDevice(request.params.deviceId);
      if (!state) return reply.code(404).send({ error: "device_not_found" });
      const body = viewerPresenceSchema.parse(request.body);
      viewerPresence.touch(request.params.deviceId, body.viewerId, body.ttlSeconds);
      return {
        ok: true,
        deviceId: request.params.deviceId,
        ...viewerPresence.snapshot(request.params.deviceId)
      };
    }
  );

  app.delete<{ Params: { deviceId: string }; Body: { viewerId: string } }>(
    "/api/devices/:deviceId/viewer-presence",
    { preHandler: requireAuth },
    async (request, reply) => {
      const state = await repositories.realtime.getDevice(request.params.deviceId);
      if (!state) return reply.code(404).send({ error: "device_not_found" });
      const body = viewerPresenceSchema.pick({ viewerId: true }).parse(request.body);
      viewerPresence.clear(request.params.deviceId, body.viewerId);
      return {
        ok: true,
        deviceId: request.params.deviceId,
        ...viewerPresence.snapshot(request.params.deviceId)
      };
    }
  );

  app.post<{ Body: AgentCloudConfigSyncPayload }>("/api/agent/device-config", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.AGENT_SHARED_SECRET) {
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
    if (token !== env.AGENT_SHARED_SECRET) {
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
    if (token !== env.AGENT_SHARED_SECRET) {
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

  app.get<{ Querystring: { deviceId: string } }>("/api/agent/control-stream", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.AGENT_SHARED_SECRET) {
      return reply.code(401).send({ error: "unauthorized_agent" });
    }

    const deviceId = request.query.deviceId?.trim();
    if (!deviceId) {
      return reply.code(400).send({ error: "missing_device_id" });
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    agentControl.writeComment(reply.raw, "connected");

    agentControl.connect(deviceId, reply.raw);
    agentControl.sendViewerRealtime(reply.raw, deviceId, viewerPresence.snapshot(deviceId));

    const keepAliveTimer = setInterval(() => {
      if (reply.raw.destroyed) {
        clearInterval(keepAliveTimer);
        return;
      }
      agentControl.sendViewerRealtime(reply.raw, deviceId, viewerPresence.snapshot(deviceId));
    }, env.AGENT_CONTROL_KEEPALIVE_MS);

    const stopKeepAlive = () => {
      clearInterval(keepAliveTimer);
      reply.raw.off("error", stopKeepAlive);
      reply.raw.socket?.off("close", stopKeepAlive);
      reply.raw.socket?.off("error", stopKeepAlive);
    };

    reply.raw.on("error", stopKeepAlive);
    reply.raw.socket?.on("close", stopKeepAlive);
    reply.raw.socket?.on("error", stopKeepAlive);
  });

  app.get<{ Querystring: { deviceId: string } }>("/api/agent/device-realtime", async (request, reply) => {
    if (rejectInsecureAgentTransport(request, reply)) return;
    const token = request.headers.authorization?.replace("Bearer ", "");
    if (token !== env.AGENT_SHARED_SECRET) {
      return reply.code(401).send({ error: "unauthorized_agent" });
    }

    const deviceId = z.string().min(1).parse(request.query.deviceId);
    const state = await repositories.realtime.getDevice(deviceId);
    if (!state) return reply.code(404).send({ error: "device_not_found" });
    return {
      deviceId,
      ...viewerPresence.snapshot(deviceId)
    };
  });
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
  if (available.get("cpuTemperature") === false) {
    return {
      ...series,
      cpuTemperatureC: [],
      cpus: series.cpus.map((cpu) => ({
        ...cpu,
        temperatureC: []
      }))
    };
  }
  return series;
}

function alignMetricSeriesToWindow(series: MetricSeries, window: MetricWindow) {
  const bucketMs =
    window === "15m" || window === "1d" ? 60_000 :
    window === "1w" || window === "1mo" || window === "1y" ? 3_600_000 :
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
    gpuTemperatureC: alignSamplePoints(series.gpuTemperatureC, bucketMs),
    memoryUsagePercent: alignSamplePoints(series.memoryUsagePercent, bucketMs),
    swapUsagePercent: alignSamplePoints(series.swapUsagePercent, bucketMs),
    memoryUsedBytes: alignSamplePoints(series.memoryUsedBytes, bucketMs),
    swapUsedBytes: alignSamplePoints(series.swapUsedBytes, bucketMs),
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
      usagePercent: alignSamplePoints(disk.usagePercent, bucketMs),
      readBytesPerSec: alignSamplePoints(disk.readBytesPerSec, bucketMs),
      writeBytesPerSec: alignSamplePoints(disk.writeBytesPerSec, bucketMs),
      temperatureC: alignSamplePoints(disk.temperatureC, bucketMs)
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
      temperatureC: alignSamplePoints(gpu.temperatureC, bucketMs)
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
