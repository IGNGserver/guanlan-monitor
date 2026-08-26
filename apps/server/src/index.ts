import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { env } from "./config.js";
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
const fanNotes = new LocalFanNoteStore(store);
const localWidgetLayouts = new LocalWidgetLayoutStore(store);
let widgetLayouts: WidgetLayoutStore = localWidgetLayouts;

const realtime = env.REDIS_URL
  ? new RedisRealtimeRepository(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }))
  : new LocalRealtimeRepository(store);

if (env.MYSQL_URL) {
  const mysqlPool = mysql.createPool(env.MYSQL_URL);
  const history = new MysqlHistoryRepository(mysqlPool);
  const devicesRepo = new MysqlDeviceRepository(mysqlPool);
  const virtualMachinesRepo = new MysqlVirtualMachineRepository(mysqlPool);
  const mysqlWidgetLayouts = new MysqlWidgetLayoutStore(mysqlPool, localWidgetLayouts);
  await history.init();
  await devicesRepo.init();
  await virtualMachinesRepo.init();
  await mysqlWidgetLayouts.init();
  widgetLayouts = mysqlWidgetLayouts;
  repositories = { realtime, history, devices: devicesRepo, virtualMachines: virtualMachinesRepo };
  app.log.info(env.REDIS_URL ? "using redis + mysql repositories" : "using local realtime + mysql history repositories");
} else {
  repositories = {
    realtime,
    history: new LocalHistoryRepository(store),
    devices: new LocalDeviceRepository(store),
    virtualMachines: new LocalVirtualMachineRepository(store)
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

await registerRoutes(app, repositories, metricsService, {
  fanNotes,
  metricConfigs: deviceMetricConfigs,
  widgetLayouts
});

app.post<{ Body: AgentMetricsPayload }>("/api/agent/ingest", async (request, reply) => {
  if (env.AGENT_REQUIRE_HTTPS) {
    const forwardedProto = request.headers["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (request.protocol !== "https" && protocol?.split(",")[0]?.trim().toLowerCase() !== "https") {
      return reply.code(400).send({ error: "https_required", message: "Agent endpoint requires HTTPS when AGENT_REQUIRE_HTTPS=true." });
    }
  }
  const token = request.headers.authorization?.replace("Bearer ", "");
  if (token !== env.ACCESS_KEY) {
    return reply.code(401).send({ error: "unauthorized_agent" });
  }

  await metricsService.ingest(request.body);
  return { ok: true };
});

const server = await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
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
