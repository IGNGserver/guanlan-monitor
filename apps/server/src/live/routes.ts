import websocket from "@fastify/websocket";
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { LiveTopic } from "@dsc/shared";
import { authRateLimiter, getBearerToken, safeEqual } from "../auth.js";
import { requireAuth } from "../routes.js";
import { AgentCredentials } from "./credentials.js";
import { LiveError, LiveRegistry } from "./registry.js";
import { agentFrameSchema, deviceIdSchema, enrollmentSchema, LIVE_HUB_REVISION, liveDataSchemas, liveTopicSchema, parseLiveMetrics } from "./schema.js";

interface Options { accessKey: string; requireHttps: boolean; credentials: AgentCredentials; registry: LiveRegistry }

export async function registerLiveRoutes(app: FastifyInstance, options: Options): Promise<void> {
  const { credentials, registry } = options;
  // Socket.IO and raw WebSocket must not both attempt to upgrade the same socket.
  const upgrades = createServer();
  await app.register(websocket, { options: { server: upgrades, maxPayload: 4 * 1024 * 1024 } });
  const routeUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = request.url?.split("?", 1)[0];
    if (pathname === "/api/agent/realtime") upgrades.emit("upgrade", request, socket, head);
    else if (pathname !== "/socket.io" && !pathname?.startsWith("/socket.io/")) socket.destroy();
  };
  app.server.on("upgrade", routeUpgrade);
  app.addHook("preClose", async () => {
    registry.close();
    app.server.removeListener("upgrade", routeUpgrade);
    upgrades.removeAllListeners("upgrade");
  });

  app.post("/api/agent/enroll", { bodyLimit: 4096 }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (options.requireHttps && request.protocol !== "https") return reply.code(400).send({ error: "https_required" });
    if (!authRateLimiter.allow(request.ip)) return reply.code(429).send({ error: "too_many_auth_attempts" });
    const token = getBearerToken(request.headers.authorization);
    if (!token || !safeEqual(token, options.accessKey)) {
      authRateLimiter.recordFailure(request.ip);
      return reply.code(401).send({ error: "unauthorized_agent" });
    }
    authRateLimiter.clear(request.ip);
    const parsed = enrollmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_enrollment" });
    const { deviceId, instanceId, token: deviceToken } = parsed.data;
    if (!await credentials.enroll(deviceId, instanceId, deviceToken)) return reply.code(409).send({ error: "device_identity_conflict" });
    return { ok: true };
  });

  app.get("/api/agent/realtime", {
    websocket: true,
    preValidation: async (request, reply) => {
      if (options.requireHttps && request.protocol !== "https") return reply.code(400).send({ error: "https_required" });
      if (!authRateLimiter.allow(request.ip)) return reply.code(429).send({ error: "too_many_auth_attempts" });
      const deviceId = request.headers["x-device-id"];
      const instanceId = request.headers["x-instance-id"];
      const token = getBearerToken(request.headers.authorization);
      if (typeof deviceId !== "string" || typeof instanceId !== "string" || !token || token.length > 128 || !credentials.verify(deviceId, instanceId, token)) {
        authRateLimiter.recordFailure(request.ip);
        return reply.code(401).send({ error: "unauthorized_agent" });
      }
      authRateLimiter.clear(request.ip);
    }
  }, (socket, request) => {
    const deviceId = request.headers["x-device-id"] as string;
    const instanceId = request.headers["x-instance-id"] as string;
    const token = getBearerToken(request.headers.authorization)!;
    let session;
    try {
      session = registry.attach(deviceId, {
        isOpen: () => socket.readyState === 1,
        send: (message) => {
          if (socket.bufferedAmount > 1024 * 1024) throw new LiveError("device_backpressure");
          socket.send(JSON.stringify(message), (error) => { if (error) socket.terminate(); });
        },
        close: () => socket.terminate()
      });
    } catch { socket.close(1008, "device_session_conflict"); return; }
    const current = session;
    let capabilities: LiveTopic[] | null = null;
    const timer = setInterval(() => {
      if (!credentials.verify(deviceId, instanceId, token)) { registry.detach(current); return; }
      try { registry.heartbeat(current); } catch { registry.detach(current); }
    }, 5_000);
    timer.unref();
    socket.on("close", () => { clearInterval(timer); registry.detach(current); });
    socket.on("error", () => registry.detach(current));
    socket.on("message", (raw, binary) => {
      try {
        if (binary) throw new Error("binary_frame");
        const frame = agentFrameSchema.parse(JSON.parse(raw.toString()));
        if (frame.type === "hello") {
          if (capabilities) throw new Error("duplicate_hello");
          capabilities = frame.capabilities;
          socket.send(JSON.stringify({ type: "welcome", sessionId: current.id, protocolVersion: 1, revision: LIVE_HUB_REVISION }));
          return;
        }
        if (frame.sessionId !== current.id || !capabilities) throw new Error("invalid_session");
        if (frame.type === "ready") registry.ready(current, capabilities);
        else if (frame.type === "pong") registry.pong(current, frame.nonce);
        else if (frame.type === "ack") registry.acknowledge(current, frame.requestId);
        else if (frame.type === "error") registry.fail(current, frame.requestId, frame.code);
        else if (frame.type === "result") {
          const data = frame.topic === "metrics" ? parseLiveMetrics(frame.data, deviceId) : liveDataSchemas[frame.topic].parse(frame.data);
          registry.result(current, frame.requestId, frame.topic, data);
        }
      } catch { registry.detach(current); }
    });
  });

  app.get<{ Params: { deviceId: string } }>("/api/devices/:deviceId/live", { preHandler: requireAuth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!deviceIdSchema.safeParse(request.params.deviceId).success) return reply.code(400).send({ error: "invalid_device_id" });
    return registry.describe(request.params.deviceId);
  });
  app.get<{ Params: { deviceId: string; topic: string } }>("/api/devices/:deviceId/live/:topic", { preHandler: requireAuth }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const topic = liveTopicSchema.safeParse(request.params.topic);
    if (!topic.success || !deviceIdSchema.safeParse(request.params.deviceId).success) return reply.code(400).send({ error: "invalid_live_query" });
    try { return await registry.read(request.params.deviceId, topic.data); }
    catch (error) {
      if (error instanceof LiveError) return reply.code(error.statusCode).send({ error: error.code });
      request.log.error("live query failed");
      return reply.code(502).send({ error: "live_query_failed" });
    }
  });
  app.addHook("onClose", async () => registry.close());
}
