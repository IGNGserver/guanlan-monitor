import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AuthLoginPayload,
  DeviceMetricConfigPayload,
  DeviceMetricKey,
  FanNotePayload,
  MetricWindow,
  TrafficCalendarMode
} from "@dsc/shared";
import { z } from "zod";
import { env } from "./config.js";
import type { MetricsService } from "./services/metrics.js";
import { LocalDeviceMetricConfigStore, LocalFanNoteStore, createLocalStore } from "./repositories/local.js";
import type { Repositories, SessionValue } from "./types.js";
import { ALL_DEVICE_METRIC_KEYS, getAvailableMetrics, timeSeriesToMetricSeries, toDetail, toSummary } from "./utils.js";

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

export async function registerRoutes(app: FastifyInstance, repositories: Repositories, metricsService: MetricsService) {
  const store = createLocalStore();
  const fanNotes = new LocalFanNoteStore(store);
  const metricConfigs = new LocalDeviceMetricConfigStore(store);
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

      const series = await metricsService.getSeries(request.params.deviceId, query.window);
      return {
        device: toDetail(state),
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        enabledMetrics,
        enabledDeviceIds: config?.enabledDeviceIds ?? {},
        instanceMetricConfig: config?.instanceMetricConfig ?? {},
        availableMetrics: getAvailableMetrics(state),
        latest: {
          cpuFrequencyMHz: state.latest.cpuFrequencyMHz ?? null,
          cpuTemperatureC: state.latest.cpuTemperatureC ?? null,
          cpuPackages: state.latest.cpuPackages ?? [],
          memoryUsedBytes: state.latest.memory.usedBytes,
          memoryTotalBytes: state.latest.memory.totalBytes,
          swapUsedBytes: state.latest.memory.swapUsedBytes,
          swapTotalBytes: state.latest.memory.swapTotalBytes,
          diskUsedBytes: state.latest.diskUsage.usedBytes,
          diskTotalBytes: state.latest.diskUsage.totalBytes,
          disks: state.latest.disks ?? [],
          networkInterfaces: state.latest.networkInterfaces ?? [],
          gpus: state.latest.gpus,
          fans: state.latest.fans.map((fan) => ({
            ...fan,
            note: notes[fan.id] ?? fan.note ?? ""
          }))
        },
        series: timeSeriesToMetricSeries(series)
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
