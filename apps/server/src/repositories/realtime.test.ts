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

function stubRedis(stored: Record<string, string>, series: Record<string, string[]> = {}) {
  const evalArgs: Array<string> = [];
  const deletedKeys: Array<string> = [];
  const redis = {
    async hvals() {
      return Object.values(stored);
    },
    async hget(_key: string, field: string) {
      return stored[field] ?? null;
    },
    async hset(_key: string, field: string, value: string) {
      stored[field] = value;
    },
    async hdel(_key: string, ...fields: string[]) {
      for (const field of fields) delete stored[field];
    },
    async del(...keys: string[]) {
      deletedKeys.push(...keys);
      for (const key of keys) delete series[key];
    },
    async scan(_cursor: string, _matchKeyword: string, pattern: string) {
      const prefix = pattern.replace(/\*$/, "");
      return ["0", Object.keys(series).filter((key) => key.startsWith(prefix))];
    },
    async lrange(key: string) {
      return series[key] ?? [];
    },
    multi() {
      const pending: Array<() => void> = [];
      const chain = {
        del(key: string) {
          pending.push(() => {
            deletedKeys.push(key);
            delete series[key];
          });
          return chain;
        },
        rpush(key: string, ...values: string[]) {
          pending.push(() => {
            series[key] = values;
          });
          return chain;
        },
        async exec() {
          for (const step of pending) step();
        }
      };
      return chain;
    },
    async eval(_script: string, _numKeys: number, _hash: string, field: string, expected: string, replacement: string) {
      evalArgs.push(field, expected, replacement);
      if (JSON.parse(stored[field]).lastSeenAt !== expected) return 0;
      stored[field] = replacement;
      return 1;
    }
  };
  return { repo: new RedisRealtimeRepository(redis as never), evalArgs, deletedKeys, stored, series };
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

test("listings hide legacy virtual machine states without hiding them from the sweep", async () => {
  const legacy = {
    ...fixture(),
    identity: { ...fixture().identity, deviceId: "vm:05c91cad", instanceType: "virtual_machine" }
  };
  const { repo, stored, series, deletedKeys } = stubRedis(
    { "node-1": JSON.stringify(fixture()), "vm:05c91cad": JSON.stringify(legacy) },
    { "dsc:series:vm:05c91cad:5m": ["{}"], "dsc:series:node-1:5m": [] }
  );

  // Every read path goes through listDevices(), so the phantom device must not surface there even
  // while the startup sweep is still running.
  assert.deepEqual((await repo.listDevices()).map((state) => state.identity.deviceId), ["node-1"]);

  // ...but the sweep reads the raw hash, so it still finds and deletes the entry. Routing the
  // sweep through the filtered listing would leave these keys in Redis forever.
  await repo.removeLegacyVirtualMachineData();

  assert.deepEqual(Object.keys(stored), ["node-1"]);
  assert.ok(deletedKeys.includes("dsc:series:vm:05c91cad:5m"));
  assert.ok(!Object.keys(series).some((key) => key.includes("vm:")));
});
