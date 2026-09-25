import Fastify, { type FastifyBaseLogger } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { env } from "./config.js";
import { authRateLimiter, getBearerToken, millisecondsUntilSessionExpiry, parseSessionValue, safeEqual } from "./auth.js";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";
import { RedisRealtimeRepository } from "./repositories/realtime.js";
import { MysqlHistoryRepository } from "./repositories/history.js";
import { MysqlDeviceRepository } from "./repositories/devices.js";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalDeviceRepository,
  LocalFanNoteStore,
  LocalHistoryRepository,
  LocalRealtimeRepository,
  LocalWidgetLayoutStore
} from "./repositories/local.js";
import { MysqlWidgetLayoutStore } from "./repositories/widget-layouts.js";
import { MetricsService } from "./services/metrics.js";
import { registerRoutes } from "./routes.js";
import type { AgentMetricsPayload, DeviceRealtimeEvent } from "@dsc/shared";
import type { Repositories, WidgetLayoutStore } from "./types.js";

process.on("uncaughtException", (error) => {
  console.error("FATAL: uncaughtException", error);
  // Give background logging/cleanup at most 3 seconds before exiting with failure
  setTimeout(() => process.exit(1), 3000).unref();
  void shutdown("uncaughtException").finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  console.error("FATAL: unhandledRejection", reason);
  setTimeout(() => process.exit(1), 3000).unref();
  void shutdown("unhandledRejection").finally(() => process.exit(1));
});

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
const legacyCleanupSteps: Array<() => Promise<void>> = [() => store.removeLegacyVirtualMachineData()];
const deviceMetricConfigs = new LocalDeviceMetricConfigStore(store);
const fanNotes = new LocalFanNoteStore(store);
const localWidgetLayouts = new LocalWidgetLayoutStore(store);
let widgetLayouts: WidgetLayoutStore = localWidgetLayouts;

let redisClient: Redis | null = null;
if (env.REDIS_URL) {
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 1000, 10000);
    }
  });
  redisClient.on("error", (err) => {
    app.log.error({ err }, "Redis connection error");
  });
}
const realtime = redisClient
  ? new RedisRealtimeRepository(redisClient)
  : new LocalRealtimeRepository(store);
if (realtime instanceof RedisRealtimeRepository) legacyCleanupSteps.push(() => realtime.removeLegacyVirtualMachineData());

let mysqlPool: mysql.Pool | null = null;
if (env.MYSQL_URL) {
  const pool = mysql.createPool({
    uri: env.MYSQL_URL,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  });
  mysqlPool = pool;
  pool.pool.on("error", (err: unknown) => {
    app.log.error({ err }, "MySQL pool error");
  });
  const history = new MysqlHistoryRepository(pool);
  const devicesRepo = new MysqlDeviceRepository(pool);
  const mysqlWidgetLayouts = new MysqlWidgetLayoutStore(pool, localWidgetLayouts);
  await history.init();
  await devicesRepo.init();
  await mysqlWidgetLayouts.init();
  legacyCleanupSteps.push(() => removeLegacyVirtualMachineData(pool, app.log));
  widgetLayouts = mysqlWidgetLayouts;
  repositories = { realtime, history, devices: devicesRepo };
  app.log.info(env.REDIS_URL ? "using redis + mysql repositories" : "using local realtime + mysql history repositories");
} else {
  const localHistory = new LocalHistoryRepository(store);
  repositories = {
    realtime,
    history: localHistory,
    devices: new LocalDeviceRepository(store)
  };
  // Non-blocking cleanup off startup critical path
  void localHistory.runRetentionCleanup().catch((error) => {
    app.log.error({ error }, "initial local history retention cleanup failed");
  });
  app.log.warn("MYSQL_URL missing, falling back to local JSON history storage");
}

const LEGACY_CLEANUP_CHUNK_ROWS = 2_000;
const LEGACY_CLEANUP_ID_SPAN = 20_000;

async function removeLegacyVirtualMachineData(pool: mysql.Pool, log: FastifyBaseLogger) {
  await pool.query("DROP TABLE IF EXISTS virtual_machines");
  await pool.query("DELETE FROM devices WHERE device_id LIKE 'vm:%'");
  for (const table of ["device_minute_metrics", "device_hourly_metrics"]) {
    // Chunked because the agents insert into these same tables: one unbounded statement over a
    // multi-gigabyte history table holds row locks long enough to fail live ingestion.
    for (;;) {
      const [result] = await pool.query(
        `DELETE FROM ${table} WHERE device_id LIKE 'vm:%' ORDER BY id LIMIT ${LEGACY_CLEANUP_CHUNK_ROWS}`
      );
      const deleted = (result as { affectedRows?: number }).affectedRows ?? 0;
      if (!deleted) break;
      log.info({ table, deleted }, "removed legacy virtual machine history rows");
    }
    const [bounds] = await pool.query(`SELECT COALESCE(MIN(id), 0) AS lowest, COALESCE(MAX(id), 0) AS highest FROM ${table}`);
    const { lowest, highest } = (bounds as Array<{ lowest: number; highest: number }>)[0];
    for (const key of ["virtualization", "storagePools"]) {
      for (let start = lowest; start <= highest; start += LEGACY_CLEANUP_ID_SPAN) {
        await pool.query(
          `UPDATE ${table} SET recorded_details_json = JSON_REMOVE(recorded_details_json, '$.${key}') WHERE id BETWEEN ? AND ? AND JSON_CONTAINS_PATH(recorded_details_json, 'one', '$.${key}')`,
          [start, start + LEGACY_CLEANUP_ID_SPAN - 1]
        );
      }
    }
  }
  await pool.query("DELETE FROM widget_layout_instances WHERE scope_key LIKE '%vm:%' OR template_key LIKE '%virtual_machine%'");
  await pool.query("DELETE FROM widget_layout_templates WHERE template_key LIKE '%virtual_machine%'");
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
  const clientKey = request.ip;
  if (!authRateLimiter.allow(clientKey)) {
    reply.header("Retry-After", "60");
    return reply.code(429).send({ error: "too_many_auth_attempts" });
  }
  const token = getBearerToken(request.headers.authorization);
  if (!token || !safeEqual(token, env.ACCESS_KEY)) {
    authRateLimiter.recordFailure(clientKey);
    return reply.code(401).send({ error: "unauthorized_agent" });
  }
  authRateLimiter.clear(clientKey);

  const parsed = agentMetricsPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_agent_payload" });
  }
  if (parsed.data.identity.deviceId.startsWith("vm:")) {
    return reply.code(400).send({ error: "invalid_agent_payload" });
  }

  await metricsService.ingest(parsed.data);
  return { ok: true };
});

const server = await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });

// Deliberately after listen(): these sweeps outlive the data they target, and awaiting them
// here kept the whole hub unreachable for as long as the largest history table took to clear.
void (async () => {
  for (const step of legacyCleanupSteps) {
    try {
      await step();
    } catch (error) {
      app.log.error({ error }, "legacy virtual machine cleanup failed");
    }
  }
})();

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
    if (!unsigned.valid) {
      return next(new Error("unauthorized"));
    }
    const session = parseSessionValue(unsigned.value, env.ACCESS_KEY);
    if (!session) return next(new Error("unauthorized"));
    socket.data.session = session;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  const expiryTimer = setTimeout(() => {
    socket.disconnect(true);
  }, millisecondsUntilSessionExpiry(socket.data.session));
  socket.once("disconnect", () => clearTimeout(expiryTimer));
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
