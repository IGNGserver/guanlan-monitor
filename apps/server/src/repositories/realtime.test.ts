import assert from "node:assert/strict";
import test from "node:test";
import { RedisRealtimeRepository } from "./realtime.js";
import type { DeviceRealtimeState } from "../types.js";

function fixture(): DeviceRealtimeState {
  return {
    identity: { deviceId: "node-1", hostname: "node-1", os: "linux", platform: "linux", arch: "x64" },
    status: "online",
    lastSeenAt: "2026-09-25T00:00:00.000Z",
    latest: {
      identity: { deviceId: "node-1", hostname: "node-1", os: "linux", platform: "linux", arch: "x64" },
      timestamp: "2026-09-25T00:00:00.000Z",
      heartbeatAt: "2026-09-25T00:00:00.000Z",
      system: { processCount: 1, threadCount: 1, handleCount: 1 },
      cpuUsagePercent: 10,
      memory: {
        totalBytes: 1000,
        usedBytes: 500,
        availableBytes: 500,
        cachedBytes: 0,
        committedBytes: 0,
        commitLimitBytes: 0,
        swapTotalBytes: 0,
        swapUsedBytes: 0
      },
      diskUsage: { totalBytes: 1000, usedBytes: 250 },
      diskRate: { readBytesPerSec: 0, writeBytesPerSec: 0 },
      networkRate: { rxBytesPerSec: 0, txBytesPerSec: 0, totalRxBytes: 0, totalTxBytes: 0 },
      gpus: [],
      fans: []
    }
  } as DeviceRealtimeState;
}

function stubRedis(stored: Record<string, string>) {
  const evalArgs: Array<string> = [];
  const redis = {
    async hvals() {
      return Object.values(stored);
    },
    async hget(_key: string, field: string) {
      return stored[field] ?? null;
    },
    async eval(_script: string, _numKeys: number, _hash: string, field: string, expected: string, replacement: string) {
      evalArgs.push(field, expected, replacement);
      if (JSON.parse(stored[field]).lastSeenAt !== expected) return 0;
      stored[field] = replacement;
      return 1;
    }
  };
  return { repo: new RedisRealtimeRepository(redis as never), evalArgs };
}

test("marking a device offline writes back arrays as arrays instead of cjson objects", async () => {
  const state = fixture();
  const { repo, evalArgs } = stubRedis({ "node-1": JSON.stringify(state) });

  const marked = await repo.markOfflineIfMatch("node-1", state.lastSeenAt, { ...state, status: "offline" });

  assert.equal(marked, true);
  const written = JSON.parse(evalArgs[2]);
  assert.deepEqual(written.latest.gpus, []);
  assert.equal(written.status, "offline");
});

test("marking a device offline does not overwrite a fresher sample", async () => {
  const state = fixture();
  const { repo } = stubRedis({ "node-1": JSON.stringify(state) });

  const marked = await repo.markOfflineIfMatch("node-1", "2020-01-01T00:00:00.000Z", { ...state, status: "offline" });

  assert.equal(marked, false);
});

test("reads repair device state that Redis already mangled", async () => {
  const mangled = JSON.stringify({ ...fixture(), latest: { ...fixture().latest, gpus: {} } });
  const { repo } = stubRedis({ "node-1": mangled });

  const [listed] = await repo.listDevices();

  assert.deepEqual(listed.latest.gpus, []);
  assert.deepEqual((await repo.getDevice("node-1"))?.latest.gpus, []);
});
