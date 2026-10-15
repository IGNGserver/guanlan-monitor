import { z } from "zod";
import { agentMetricsPayloadSchema } from "../metrics-schema.js";

const text = z.string().max(1024);
const counter = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
export const liveTopicSchema = z.enum(["metrics", "processes", "docker"]);
export const deviceIdSchema = z.string().trim().min(1).max(128).refine((id) => !id.startsWith("vm:") && !/[\u0000-\u001f]/.test(id));
export const enrollmentSchema = z.object({ deviceId: deviceIdSchema, instanceId: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const agentFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocolVersion: z.literal(1), capabilities: z.array(liveTopicSchema).max(3) }).strict(),
  z.object({ type: z.literal("ready"), sessionId: z.uuid() }).strict(),
  z.object({ type: z.literal("pong"), sessionId: z.uuid(), nonce: z.uuid() }).strict(),
  z.object({ type: z.literal("ack"), sessionId: z.uuid(), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal("result"), sessionId: z.uuid(), requestId: z.uuid(), topic: liveTopicSchema, data: z.unknown() }).strict(),
  z.object({ type: z.literal("error"), sessionId: z.uuid(), requestId: z.uuid(), code: z.enum(["collection_failed", "collection_disabled", "collection_busy", "docker_unavailable", "docker_permission_denied", "query_expired"]) }).strict()
]);

export const liveDataSchemas = {
  metrics: agentMetricsPayloadSchema,
  processes: z.object({
    observedAt: timestamp, cpuScale: z.literal("host"), memoryKind: z.literal("rss"),
    totalCount: counter, truncated: z.boolean(),
    items: z.array(z.object({
      id: text, pid: counter, parentPid: counter.nullable(), name: text,
      startedAt: timestamp.nullable(), cpuPercent: counter.nullable(), memoryBytes: counter.nullable(),
      threads: counter.nullable(), status: text.nullable()
    }).strict()).max(4096)
  }).strict(),
  docker: z.object({
    observedAt: timestamp, engineId: text, totalCount: counter, truncated: z.boolean(),
    items: z.array(z.object({
      id: text, name: text, image: text, state: text, status: text, project: text.nullable(),
      cpuPercent: counter.nullable(), memoryBytes: counter.nullable(), memoryLimitBytes: counter.nullable(),
      networkRxBytes: counter.nullable(), networkTxBytes: counter.nullable(),
      blockReadBytes: counter.nullable(), blockWriteBytes: counter.nullable()
    }).strict()).max(512)
  }).strict()
};
