import Fastify, { type FastifyBaseLogger } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { env, redisNamespace } from "./config.js";
import { authRateLimiter, getBearerToken, parseSessionValue, safeEqual } from "./auth.js";
import { nonOverlappingTask, scheduleSessionExpiry } from "./lifecycle.js";
import { QueueCapacityError } from "./serial-queue.js";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";
import { RedisRealtimeRepository } from "./repositories/realtime.js";
import { MysqlHistoryRepository } from "./repositories/history.js";
import { MysqlDeviceRepository } from "./repositories/devices.js";
import { CachedHistoryRepository } from "./repositories/cached-history.js";
import { createMysqlPool, assertMysqlServerCompatibility } from "./storage/mysql.js";
import { MysqlStoreMetadata } from "./storage/store-metadata.js";
import { RedisReadCache } from "./storage/redis-read-cache.js";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalDeviceRepository,
  LocalFanNoteStore,
  LocalHistoryRepository,
  LocalRealtimeRepository
} from "./repositories/local.js";
import { MetricsService } from "./services/metrics.js";
import { registerRoutes } from "./routes.js";
import { registerRequestTiming } from "./request-timing.js";
import { registerInventoryRecovery } from "./inventory-recovery.js";
import { resolve } from "node:path";
import { AgentCredentials } from "./live/credentials.js";
import { LiveRegistry } from "./live/registry.js";
import { registerLiveRoutes } from "./live/routes.js";
import type { AgentMetricsPayload, DeviceRealtimeEvent } from "@dsc/shared";
import type { Repositories } from "./types.js";

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
registerRequestTiming(app);
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

let redisClient: Redis | null = null;
if (env.REDIS_URL) {
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
    retryStrategy(times) {
      return Math.min(times * 1000, 10000);
    }
  });
  redisClient.on("error", (err) => {
    app.log.error({ err }, "Redis connection error");
  });
}
const realtime = redisClient
  ? new RedisRealtimeRepository(redisClient, redisNamespace)
  : new LocalRealtimeRepository(store);
if (realtime instanceof RedisRealtimeRepository) {
  await realtime.initializeReadModels();
  legacyCleanupSteps.push(() => realtime.removeLegacyVirtualMachineData());
}

let mysqlPool: mysql.Pool | null = null;
let storeMetadata: MysqlStoreMetadata | undefined;
if (env.MYSQL_URL) {
  const mysqlDatabaseName = decodeURIComponent(new URL(env.MYSQL_URL).pathname.slice(1));
  const pool = createMysqlPool(env.MYSQL_URL, {
    connectionLimit: env.MYSQL_POOL_SIZE,
    queueLimit: env.MYSQL_QUEUE_LIMIT,
    connectTimeoutMs: env.MYSQL_CONNECT_TIMEOUT_MS,
    idleTimeoutMs: env.MYSQL_IDLE_TIMEOUT_MS
  });
  mysqlPool = pool;
  pool.pool.on("error", (err: unknown) => {
    app.log.error({ err }, "MySQL pool error");
  });
  const history = new MysqlHistoryRepository(pool, {
    queryTimeoutMs: env.MYSQL_QUERY_TIMEOUT_MS
  });
  const devicesRepo = new MysqlDeviceRepository(pool, {
    listCacheTtlMs: env.DSC_DEVICE_CACHE_TTL_MS
  });
  // External databases may not be ready when the container starts. Retry the
  // idempotent setup instead of crashing into a Docker restart backoff loop.
  for (let attempt = 1; ; attempt++) {
    try {
      await assertMysqlServerCompatibility(pool);
      storeMetadata ??= new MysqlStoreMetadata(pool, env.DSC_INSTANCE_ID, {
        writerLock: env.DSC_DB_WRITER_LOCK || env.DSC_DB_MODE === "external",
        databaseName: mysqlDatabaseName,
        connect: () => mysql.createConnection({ uri: env.MYSQL_URL, connectTimeout: env.MYSQL_CONNECT_TIMEOUT_MS })
      });
      await storeMetadata.initialize();
      await storeMetadata.acquireWriterLock();
      await history.init();
      await devicesRepo.init();
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      const delay = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
      app.log.warn({ error, attempt, delay }, "MySQL initialization failed; retrying");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  const sharedCache = redisClient && env.DSC_REDIS_CACHE_ENABLED
    ? new RedisReadCache(redisClient, redisNamespace)
    : undefined;
  const cachedHistory = new CachedHistoryRepository(history, {
    ttlMs: env.DSC_HISTORY_CACHE_TTL_MS,
    calendarTtlMs: env.DSC_CALENDAR_CACHE_TTL_MS,
    maxEntries: env.DSC_CACHE_MAX_ENTRIES,
    maxBytes: env.DSC_CACHE_MAX_BYTES,
    shared: sharedCache,
    onError: (error) => app.log.warn({ error }, "shared read cache unavailable; using MySQL")
  });
  legacyCleanupSteps.push(() => removeRetiredTables(pool, app.log));
  legacyCleanupSteps.push(() => removeLegacyVirtualMachineData(pool, app.log));
  repositories = { realtime, history: cachedHistory, devices: devicesRepo };
  app.log.info({
    dbMode: env.DSC_DB_MODE,
    instanceId: env.DSC_INSTANCE_ID,
    redisNamespace,
    cache: { l1: env.DSC_HISTORY_CACHE_TTL_MS > 0, l2: Boolean(sharedCache) }
  }, env.REDIS_URL ? "using redis + mysql repositories" : "using local realtime + mysql history repositories");
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
const RETIRED_TABLES = ["widget_layout_instances", "widget_layout_templates"];

async function removeRetiredTables(pool: mysql.Pool, log: FastifyBaseLogger) {
  const [rows] = await pool.query<any[]>(
    `SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    RETIRED_TABLES
  );
  for (const row of rows) {
    const table = String(row.tableName);
    if (!RETIRED_TABLES.includes(table)) continue;
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    log.info({ table }, "removed retired hub table");
  }
}

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
    // Only the retired virtual machine payload is purged; `storagePools` is a
    // first-class host metric again and must survive hub restarts.
    for (const key of ["virtualization"]) {
      for (let start = lowest; start <= highest; start += LEGACY_CLEANUP_ID_SPAN) {
        await pool.query(
          `UPDATE ${table} SET recorded_details_json = JSON_REMOVE(recorded_details_json, '$.${key}') WHERE id BETWEEN ? AND ? AND JSON_CONTAINS_PATH(recorded_details_json, 'one', '$.${key}')`,
          [start, start + LEGACY_CLEANUP_ID_SPAN - 1]
        );
      }
    }
  }
}

let io: SocketIOServer | null = null;
const metricsService = new MetricsService(
  repositories,
  (event: DeviceRealtimeEvent) => {
    io?.emit("device:update", event);
  },
  deviceMetricConfigs
);

const liveRegistry = new LiveRegistry();
const agentCredentials = new AgentCredentials(resolve("data", "agent-credentials.json"), env.ACCESS_KEY);
await agentCredentials.load();
await registerLiveRoutes(app, { accessKey: env.ACCESS_KEY, requireHttps: env.AGENT_REQUIRE_HTTPS, credentials: agentCredentials, registry: liveRegistry });
await registerRoutes(app, repositories, metricsService, {
  fanNotes,
  metricConfigs: deviceMetricConfigs,
  removeLiveDevice: async (deviceId) => {
    await agentCredentials.remove(deviceId);
    liveRegistry.closeDevice(deviceId);
  }
});

app.post<{ Body: AgentMetricsPayload }>("/api/agent/ingest", async (request, reply) => {
  if (shuttingDown) return reply.header("Retry-After", "1").code(503).send({ error: "hub_shutting_down" });
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

  try {
    await metricsService.ingest(parsed.data);
  } catch (error) {
    if (!(error instanceof QueueCapacityError)) throw error;
    return reply.header("Retry-After", "1").code(503).send({ error: "hub_queue_capacity" });
  }
  return { ok: true };
});

registerInventoryRecovery(app, repositories);
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
  destroyUpgrade: false,
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
  const cancelExpiry = scheduleSessionExpiry(socket.data.session, () => {
    socket.disconnect(true);
  });
  socket.once("disconnect", cancelExpiry);
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

const runRetentionCleanup = nonOverlappingTask(async () => {
  const cleanup = repositories.history.runRetentionCleanup;
  if (!cleanup) return;
  await cleanup.call(repositories.history);
});
const retentionTimer = setInterval(() => {
  void runRetentionCleanup().catch((error) => {
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
  liveRegistry.close();
  io?.disconnectSockets(true);
  // Drain accepted HTTP ingests before the final aggregate snapshot. Flushing
  // first could miss samples that were already queued when shutdown began.
  await app.close();
  try {
    await metricsService.flushAfterDrain();
  } catch (error) {
    app.log.error({ error }, "aggregate flush failed during shutdown");
  }
  await runRetentionCleanup.drain().catch((error) => app.log.error({ error }, "retention shutdown failed"));
  if (mysqlPool && repositories) {
    await repositories.history.flushWrites?.().catch((error) => app.log.error({ error }, "history write flush failed"));
    await storeMetadata?.releaseWriterLock().catch((error) => app.log.error({ error }, "writer lock release failed"));
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
