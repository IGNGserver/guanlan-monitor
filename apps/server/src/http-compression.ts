import { promisify } from "node:util";
import { constants as zlibConstants, createGunzip, gzip as gzipCallback } from "node:zlib";
import { Transform } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { AgentMetricsPayload } from "@dsc/shared";
import { authRateLimiter, getBearerToken, safeEqual } from "./auth.js";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";
import { QueueCapacityError } from "./serial-queue.js";
import type { MetricsService } from "./services/metrics.js";
import type { LiveRegistry } from "./live/registry.js";

const gzipAsync = promisify(gzipCallback);
const MAX_GUNZIP_BYTES = 4 * 1024 * 1024;
const MIN_GZIP_RESPONSE_BYTES = 1024;

export function registerHttpCompression(app: FastifyInstance): void {
  app.addHook("preParsing", async (request, _reply, payload) => {
    const encoding = String(request.headers["content-encoding"] ?? "").toLowerCase().trim();
    if (encoding !== "gzip") {
      return payload;
    }
    delete request.headers["content-encoding"];
    delete request.headers["content-length"];

    const gunzip = createGunzip({ maxOutputLength: MAX_GUNZIP_BYTES });
    const guard = new Transform({
      transform(chunk, _enc, callback) {
        callback(null, chunk);
      }
    });
    gunzip.on("error", (error: NodeJS.ErrnoException) => {
      const statusCode = error?.code === "ERR_BUFFER_TOO_LARGE" ? 413 : 400;
      guard.destroy(Object.assign(new Error("invalid_gzip_payload"), { statusCode }));
    });
    payload.on("error", (error) => {
      gunzip.destroy(error);
    });
    return payload.pipe(gunzip).pipe(guard);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "HEAD" || reply.statusCode === 204 || reply.statusCode === 304) {
      return payload;
    }
    if (reply.getHeader("content-encoding")) {
      return payload;
    }
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (!contentType.includes("application/json")) {
      return payload;
    }

    const existingVary = String(reply.getHeader("vary") ?? "");
    if (!/\baccept-encoding\b/i.test(existingVary)) {
      reply.header("Vary", existingVary ? `${existingVary}, Accept-Encoding` : "Accept-Encoding");
    }

    const acceptEncoding = String(request.headers["accept-encoding"] ?? "");
    if (!/\bgzip\b/i.test(acceptEncoding)) {
      return payload;
    }
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) {
      return payload;
    }

    const rawBuffer = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
    if (rawBuffer.byteLength < MIN_GZIP_RESPONSE_BYTES) {
      return payload;
    }

    const compressed = await gzipAsync(rawBuffer, { level: zlibConstants.Z_BEST_SPEED });
    if (compressed.byteLength >= rawBuffer.byteLength) {
      return payload;
    }
    reply.header("Content-Encoding", "gzip");
    reply.header("Content-Length", String(compressed.byteLength));
    return compressed;
  });
}

export interface AgentIngestRouteOptions {
  accessKey: string;
  requireHttps: boolean;
  metricsService: MetricsService;
  liveRegistry?: Pick<LiveRegistry, "isWanted">;
  isShuttingDown?: () => boolean;
}

export function registerAgentIngestRoute(app: FastifyInstance, options: AgentIngestRouteOptions): void {
  app.post<{ Body: AgentMetricsPayload }>("/api/agent/ingest", async (request, reply) => {
    if (options.isShuttingDown?.()) {
      return reply.header("Retry-After", "1").code(503).send({ error: "hub_shutting_down" });
    }
    if (options.requireHttps && request.protocol !== "https") {
      return reply.code(400).send({ error: "https_required", message: "Agent endpoint requires HTTPS when AGENT_REQUIRE_HTTPS=true." });
    }
    const clientKey = request.ip;
    if (!authRateLimiter.allow(clientKey)) {
      reply.header("Retry-After", "60");
      return reply.code(429).send({ error: "too_many_auth_attempts" });
    }
    const token = getBearerToken(request.headers.authorization);
    if (!token || !safeEqual(token, options.accessKey)) {
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

    let ingestResult: { needInventory?: boolean } = {};
    try {
      ingestResult = (await options.metricsService.ingest(parsed.data)) ?? {};
    } catch (error) {
      if (!(error instanceof QueueCapacityError)) throw error;
      return reply.header("Retry-After", "1").code(503).send({ error: "hub_queue_capacity" });
    }

    return {
      ok: true,
      capabilities: {
        gzip: true,
        liveOnDemand: true,
        inventoryDelta: true
      },
      liveWanted: options.liveRegistry?.isWanted(parsed.data.identity.deviceId) ?? false,
      ...(ingestResult.needInventory ? { needInventory: true } : {})
    };
  });
}
