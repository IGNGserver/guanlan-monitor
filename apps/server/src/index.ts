import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { env } from "./config.js";
import { getBearerToken, parseSessionValue, safeEqual } from "./auth.js";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";
import { RedisRealtimeRepository } from "./repositories/realtime.js";
import { MysqlHistoryRepository } from "./repositories/history.js";
import { MysqlDeviceRepository } from "./repositories/devices.js";
import { MysqlVirtualMachineRepository } from "./repositories/virtual-machines.js";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalDeviceRepository,
  LocalFanNoteStore,
  LocalHistoryRepository,
  LocalRealtimeRepository,
  LocalWidgetLayoutStore,
  LocalVirtualMachineRepository
} from "./repositories/local.js";
import { MysqlWidgetLayoutStore } from "./repositories/widget-layouts.js";
import { MetricsService } from "./services/metrics.js";
import { registerRoutes } from "./routes.js";
import type { AgentMetricsPayload, DeviceRealtimeEvent } from "@dsc/shared";
import type { Repositories, WidgetLayoutStore } from "./types.js";

const configuredCorsOrigins = new Set(
  (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const corsOrigins = configuredCorsOrigins.size ? [...configuredCorsOrigins] : false;

const app = Fastify({
  logger: true,
  bodyLimit: 4 * 1024 * 1024,
  trustProxy: env.TRUST_PROXY
});
await app.register(cors, {
  origin: corsOrigins,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"]
});
await app.register(cookie, { secret: env.SESSION_SECRET });

let repositories: Repositories;
const store = createLocalStore();
const deviceMetricConfigs = new LocalDeviceMetricConfigStore(store);
const fanNotes = new LocalFanNoteStore(store);
const localWidgetLayouts = new LocalWidgetLayoutStore(store);
let widgetLayouts: WidgetLayoutStore = localWidgetLayouts;

let redisClient: Redis | null = null;
const realtime = env.REDIS_URL
  ? new RedisRealtimeRepository((redisClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })))
  : new LocalRealtimeRepository(store);

let mysqlPool: mysql.Pool | null = null;
if (env.MYSQL_URL) {
  const pool = mysql.createPool(env.MYSQL_URL);
  mysqlPool = pool;
  const history = new MysqlHistoryRepository(pool);
  const devicesRepo = new MysqlDeviceRepository(pool);
  const virtualMachinesRepo = new MysqlVirtualMachineRepository(pool);
  const mysqlWidgetLayouts = new MysqlWidgetLayoutStore(pool, localWidgetLayouts);
  await history.init();
  await devicesRepo.init();
  await virtualMachinesRepo.init();
  await mysqlWidgetLayouts.init();
  widgetLayouts = mysqlWidgetLayouts;
  repositories = { realtime, history, devices: devicesRepo, virtualMachines: virtualMachinesRepo };
  app.log.info(env.REDIS_URL ? "using redis + mysql repositories" : "using local realtime + mysql history repositories");
} else {
  const localHistory = new LocalHistoryRepository(store);
  repositories = {
    realtime,
    history: localHistory,
    devices: new LocalDeviceRepository(store),
    virtualMachines: new LocalVirtualMachineRepository(store)
  };
  await localHistory.runRetentionCleanup();
  app.log.warn("MYSQL_URL missing, falling back to local JSON history storage");
}

let io: SocketIOServer | null = null;
const metricsService = new MetricsService(
  repositories,
  (event: DeviceRealtimeEvent) => {
    io?.emit("device:update", event);
  },
  deviceMetricConfigs
);

await registerRoutes(app, repositories, metricsService, {
  fanNotes,
  metricConfigs: deviceMetricConfigs,
  widgetLayouts
});

app.post<{ Body: AgentMetricsPayload }>("/api/agent/ingest", async (request, reply) => {
  if (env.AGENT_REQUIRE_HTTPS && request.protocol !== "https") {
    return reply.code(400).send({ error: "https_required", message: "Agent endpoint requires HTTPS when AGENT_REQUIRE_HTTPS=true." });
  }
  const token = getBearerToken(request.headers.authorization);
  if (!token || !safeEqual(token, env.ACCESS_KEY)) {
    return reply.code(401).send({ error: "unauthorized_agent" });
  }

  const parsed = agentMetricsPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_agent_payload" });
  }

  await metricsService.ingest(parsed.data as AgentMetricsPayload);
  return { ok: true };
});

const server = await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
io = new SocketIOServer(app.server, {
  path: "/socket.io",
  addTrailingSlash: false,
  cors: {
    origin: configuredCorsOrigins.size ? [...configuredCorsOrigins] : false,
    credentials: true
  }
});

io.use((socket, next) => {
  try {
    const cookies = app.parseCookie(socket.request.headers.cookie ?? "");
    const rawSession = cookies.dsc_session;
    if (!rawSession) return next(new Error("unauthorized"));
    const unsigned = app.unsignCookie(rawSession);
    if (!unsigned.valid || !parseSessionValue(unsigned.value, env.ACCESS_KEY)) {
      return next(new Error("unauthorized"));
    }
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

const offlineTimer = setInterval(() => {
  void metricsService.markOfflineDevices().catch((error) => {
    app.log.error({ error }, "offline device scan failed");
  });
}, 5_000);

const aggregateFlushTimer = setInterval(() => {
  void metricsService.flushAggregates().catch((error) => {
    app.log.error({ error }, "periodic aggregate flush failed");
  });
}, 60_000);

const retentionTimer = setInterval(() => {
  const cleanup = repositories.history.runRetentionCleanup;
  if (!cleanup) return;
  void cleanup.call(repositories.history).catch((error) => {
    app.log.error({ error }, "history retention cleanup failed");
  });
}, 6 * 60 * 60 * 1000);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "server shutdown requested");
  clearInterval(offlineTimer);
  clearInterval(aggregateFlushTimer);
  clearInterval(retentionTimer);
  try {
    await metricsService.flushAggregates();
  } catch (error) {
    app.log.error({ error }, "aggregate flush failed during shutdown");
  }
  await app.close();
  if (mysqlPool) {
    await mysqlPool.end().catch((error) => app.log.error({ error }, "mysql shutdown failed"));
  }
  redisClient?.disconnect();
};

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").catch((error) => {
    app.log.error({ error }, "SIGTERM shutdown failed");
    process.exitCode = 1;
  });
});
process.once("SIGINT", () => {
  void shutdown("SIGINT").catch((error) => {
    app.log.error({ error }, "SIGINT shutdown failed");
    process.exitCode = 1;
  });
});

app.log.info(`server listening on ${server}`);
