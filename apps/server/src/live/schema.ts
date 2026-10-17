import { z } from "zod";
import type { LiveMetrics } from "@dsc/shared";
import { agentMetricsPayloadSchema } from "../metrics-schema.js";

/**
 * Announced in welcome. Revision 1/2 Agents/Hubs only know the original
 * process item shape; an Agent sends newer shapes only after a Hub announces
 * support for them.
 */
export const LIVE_HUB_REVISION = 3;

const text = z.string().max(1024);
const counter = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percent = z.number().finite().min(0).max(100).nullable();
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

const rate = z.number().finite().nonnegative().nullable();
export const liveMetricsSchema = z.object({
  observedAt: timestamp,
  cpuPercent: z.number().finite().min(0).max(100).nullable(),
  memoryUsedBytes: counter.nullable(), memoryTotalBytes: counter.nullable(),
  diskReadBytesPerSec: rate, diskWriteBytesPerSec: rate,
  networkRxBytesPerSec: rate, networkTxBytesPerSec: rate
}).strict();

/** Revision-1 Agents answer with the full upload payload; viewers only ever receive LiveMetrics. */
export function parseLiveMetrics(data: unknown, deviceId: string): LiveMetrics {
  const current = liveMetricsSchema.safeParse(data);
  if (current.success) return current.data;
  const legacy = agentMetricsPayloadSchema.parse(data);
  if (legacy.identity.deviceId !== deviceId) throw new Error("identity_mismatch");
  const unavailable = new Set<string>(legacy.unavailableMetrics ?? []);
  const value = (key: string, reading: number) => unavailable.has(key) ? null : reading;
  const memory = !unavailable.has("memoryUsage") && legacy.memory.totalBytes > 0;
  return {
    observedAt: legacy.timestamp,
    cpuPercent: value("cpuUsage", legacy.cpuUsagePercent),
    memoryUsedBytes: memory ? legacy.memory.usedBytes : null,
    memoryTotalBytes: memory ? legacy.memory.totalBytes : null,
    diskReadBytesPerSec: value("diskRead", legacy.diskRate.readBytesPerSec),
    diskWriteBytesPerSec: value("diskWrite", legacy.diskRate.writeBytesPerSec),
    networkRxBytesPerSec: value("networkRxRate", legacy.networkRate.rxBytesPerSec),
    networkTxBytesPerSec: value("networkTxRate", legacy.networkRate.txBytesPerSec)
  };
}

export const liveDataSchemas = {
  processes: z.object({
    observedAt: timestamp, cpuScale: z.literal("host"), memoryKind: z.literal("rss"),
    totalCount: counter, truncated: z.boolean(),
    items: z.array(z.union([
      z.object({
        id: text, pid: counter, parentPid: counter.nullable(), name: text,
        startedAt: timestamp.nullable(), cpuPercent: percent, gpuPercent: percent, memoryBytes: counter.nullable(),
        threads: counter.nullable(), status: text.nullable()
      }).strict(),
      // A revision-2 Agent may remain connected to this revision-3 Hub. Add
      // the new field at the boundary instead of rejecting its old result.
      z.object({
        id: text, pid: counter, parentPid: counter.nullable(), name: text,
        startedAt: timestamp.nullable(), cpuPercent: percent, memoryBytes: counter.nullable(),
        threads: counter.nullable(), status: text.nullable()
      }).strict().transform((item) => ({ ...item, gpuPercent: null }))
    ])).max(4096)
  }).strict(),
  docker: z.object({
    observedAt: timestamp, engineId: text, totalCount: counter, truncated: z.boolean(),
    items: z.array(z.object({
      id: text, name: text, image: text, state: text, status: text, project: text.nullable(),
      cpuPercent: counter.nullable(), memoryBytes: counter.nullable(), memoryLimitBytes: counter.nullable(),
      networkRxBytes: counter.nullable(), networkTxBytes: counter.nullable(),
      blockReadBytes: counter.nullable(), blockWriteBytes: counter.nullable()
    }).strict()).max(512),
    statsCandidates: counter.optional(), statsRead: counter.optional()
  }).strict()
};
