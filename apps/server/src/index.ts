import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { env } from "./config.js";
import { RedisRealtimeRepository } from "./repositories/realtime.js";
import { MysqlHistoryRepository } from "./repositories/history.js";
import {
  createLocalStore,
  LocalDeviceMetricConfigStore,
  LocalHistoryRepository,
  LocalRealtimeRepository
} from "./repositories/local.js";
import { MetricsService } from "./services/metrics.js";
import { registerRoutes } from "./routes.js";
import type { AgentMetricsPayload, DeviceRealtimeEvent } from "@dsc/shared";
import type { Repositories } from "./types.js";

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "OPTIONS"]
});
await app.register(cookie, { secret: env.SESSION_SECRET });

let repositories: Repositories;
const store = createLocalStore();
const deviceMetricConfigs = new LocalDeviceMetricConfigStore(store);

const realtime = env.REDIS_URL
  ? new RedisRealtimeRepository(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }))
  : new LocalRealtimeRepository(store);

if (env.MYSQL_URL) {
  const mysqlPool = mysql.createPool(env.MYSQL_URL);
  const history = new MysqlHistoryRepository(mysqlPool);
  await history.init();
  repositories = { realtime, history };
  app.log.info(env.REDIS_URL ? "using redis + mysql repositories" : "using local realtime + mysql history repositories");
} else {
  repositories = {
    realtime,
    history: new LocalHistoryRepository(store)
  };
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

await registerRoutes(app, repositories, metricsService);

app.post<{ Body: AgentMetricsPayload }>("/api/agent/ingest", async (request, reply) => {
  const token = request.headers.authorization?.replace("Bearer ", "");
  if (token !== env.AGENT_SHARED_SECRET) {
    return reply.code(401).send({ error: "unauthorized_agent" });
  }

  await metricsService.ingest(request.body);
  return { ok: true };
});

const server = await app.listen({ host: "0.0.0.0", port: env.SERVER_PORT });
io = new SocketIOServer(app.server, {
  path: "/socket.io",
  addTrailingSlash: false,
  cors: {
    origin: true,
    credentials: true
  }
});

setInterval(() => {
  void metricsService.markOfflineDevices();
}, 5_000);

app.log.info(`server listening on ${server}`);
