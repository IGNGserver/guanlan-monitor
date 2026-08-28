import assert from "node:assert/strict";
import test from "node:test";
import { agentMetricsPayloadSchema } from "./metrics-schema.js";

function validPayload() {
  const timestamp = new Date().toISOString();
  return {
    identity: {
      deviceId: "device-1",
      hostname: "host-1",
      os: "linux",
      platform: "linux",
      arch: "amd64"
    },
    timestamp,
    heartbeatAt: timestamp,
    system: { processCount: 1, threadCount: 2, handleCount: 3 },
    cpuUsagePercent: 12.5,
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      availableBytes: 50,
      cachedBytes: 10,
      committedBytes: 60,
      commitLimitBytes: 100,
      swapTotalBytes: 20,
      swapUsedBytes: 2
    },
    diskUsage: { totalBytes: 1_000, usedBytes: 500 },
    diskRate: { readBytesPerSec: 1, writeBytesPerSec: 2 },
    networkRate: { rxBytesPerSec: 3, txBytesPerSec: 4, totalRxBytes: 5, totalTxBytes: 6 },
    gpus: [] as unknown[],
    fans: []
  };
}

test("accepts the collector payload shape", () => {
  const result = agentMetricsPayloadSchema.safeParse(validPayload());
  assert.equal(result.success, true);
});

test("accepts legacy agent payloads without system counters", () => {
  const payload = validPayload();
  const legacyPayload = { ...payload } as Partial<typeof payload>;
  delete legacyPayload.system;

  const result = agentMetricsPayloadSchema.safeParse(legacyPayload);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.system, {
    processCount: 0,
    threadCount: 0,
    handleCount: 0
  });
});

test("does not hide malformed system counters behind the legacy default", () => {
  const payload = validPayload();
  payload.system.processCount = -1;
  assert.equal(agentMetricsPayloadSchema.safeParse(payload).success, false);
});

test("rejects non-finite values, stale samples, and oversized collections", () => {
  const invalidNumber = validPayload();
  invalidNumber.cpuUsagePercent = Number.NaN;
  assert.equal(agentMetricsPayloadSchema.safeParse(invalidNumber).success, false);

  const stale = validPayload();
  stale.timestamp = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(agentMetricsPayloadSchema.safeParse(stale).success, false);

  const oversized = validPayload();
  oversized.gpus = Array.from({ length: 129 }, (_, index) => ({
    id: `gpu-${index}`,
    name: `GPU ${index}`,
    utilizationPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0
  }));
  assert.equal(agentMetricsPayloadSchema.safeParse(oversized).success, false);
});
