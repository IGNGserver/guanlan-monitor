import test from "node:test";
import assert from "node:assert/strict";
import { liveDataSchemas, parseLiveMetrics } from "./schema.js";

function legacyPayload(deviceId = "node") {
  const timestamp = new Date().toISOString();
  return {
    identity: { deviceId, hostname: "node", os: "linux", platform: "linux", arch: "amd64" },
    timestamp, heartbeatAt: timestamp,
    system: { processCount: 1, threadCount: 2, handleCount: 3 },
    cpuUsagePercent: 12.5,
    memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50, cachedBytes: 10, committedBytes: 60, commitLimitBytes: 100, swapTotalBytes: 20, swapUsedBytes: 2 },
    diskUsage: { totalBytes: 1_000, usedBytes: 500 },
    diskRate: { readBytesPerSec: 1, writeBytesPerSec: 2 },
    networkRate: { rxBytesPerSec: 3, txBytesPerSec: 4, totalRxBytes: 5, totalTxBytes: 6 },
    gpus: [], fans: []
  };
}

test("revision-2 live metrics pass through and keep unavailable values null", () => {
  const sample = { observedAt: new Date().toISOString(), cpuPercent: null, memoryUsedBytes: 1, memoryTotalBytes: 2, diskReadBytesPerSec: 0, diskWriteBytesPerSec: null, networkRxBytesPerSec: 5, networkTxBytesPerSec: 6 };
  assert.deepEqual(parseLiveMetrics(sample, "node"), sample);
  assert.throws(() => parseLiveMetrics({ ...sample, cpuPercent: 120 }, "node"));
  assert.throws(() => parseLiveMetrics({ ...sample, extra: true }, "node"));
});

test("revision-1 full payloads are reduced to live metrics without inventing zeros", () => {
  const legacy = { ...legacyPayload(), unavailableMetrics: ["cpuUsage", "diskWrite"] };
  const result = parseLiveMetrics(legacy, "node");
  assert.equal(result.observedAt, legacy.timestamp);
  assert.equal(result.cpuPercent, null);
  assert.equal(result.memoryUsedBytes, 50);
  assert.equal(result.diskReadBytesPerSec, 1);
  assert.equal(result.diskWriteBytesPerSec, null);
  assert.equal(result.networkTxBytesPerSec, 4);
  assert.equal(parseLiveMetrics({ ...legacyPayload(), memory: { ...legacyPayload().memory, totalBytes: 0 } }, "node").memoryTotalBytes, null);
  assert.throws(() => parseLiveMetrics(legacyPayload("another-device"), "node"), /identity_mismatch/);
});

test("Docker coverage fields are optional so revision-1 Agents still validate", () => {
  const base = { observedAt: new Date().toISOString(), engineId: "engine", totalCount: 0, truncated: false, items: [] };
  assert.equal(liveDataSchemas.docker.safeParse(base).success, true);
  assert.equal(liveDataSchemas.docker.safeParse({ ...base, statsCandidates: 40, statsRead: 32 }).success, true);
});
