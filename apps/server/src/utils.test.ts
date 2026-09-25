import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMetricsPayload } from "@dsc/shared";
import type { DeviceRealtimeState } from "./types.js";
import { normalizeRealtimeState, toSummary } from "./utils.js";

function stateWith(latest: Partial<AgentMetricsPayload>): DeviceRealtimeState {
  const payload: AgentMetricsPayload = {
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
    fans: [],
    ...latest
  };
  return {
    identity: payload.identity,
    status: "offline",
    lastSeenAt: payload.timestamp,
    latest: payload
  };
}

/** What Redis Lua `cjson` leaves behind after an offline sweep touches a device. */
function cjsonMangled() {
  const state = stateWith({
    disks: [{ id: "disk-0", name: "sda", mountPoint: "/", totalBytes: 1, usedBytes: 1, smartAttributes: [] }],
    networkInterfaces: [{ id: "eth0", name: "eth0", ipv4: [] }]
  }) as unknown as { latest: Record<string, unknown> };
  state.latest.gpus = {};
  state.latest.fans = {};
  state.latest.sensorBackends = {};
  (state.latest.disks as Array<Record<string, unknown>>)[0].smartAttributes = {};
  (state.latest.networkInterfaces as Array<Record<string, unknown>>)[0].ipv4 = {};
  return state as unknown as DeviceRealtimeState;
}

test("repairs the empty-object shape Redis cjson writes in place of empty arrays", () => {
  const normalized = normalizeRealtimeState(cjsonMangled());
  const latest = normalized.latest as unknown as Record<string, unknown>;

  assert.deepEqual(latest.gpus, []);
  assert.deepEqual(latest.fans, []);
  assert.deepEqual(latest.sensorBackends, []);
  assert.deepEqual((latest.disks as Array<Record<string, unknown>>)[0].smartAttributes, []);
  assert.deepEqual((latest.networkInterfaces as Array<Record<string, unknown>>)[0].ipv4, []);
  assert.equal(toSummary(normalized).gpuUsagePercent, null);
});

test("leaves populated and absent list fields untouched", () => {
  const state = normalizeRealtimeState(
    stateWith({ gpus: [{ id: "gpu-0", name: "iGPU", utilizationPercent: 40, memoryUsedBytes: 1, memoryTotalBytes: 3 }] })
  );

  assert.equal(state.latest.gpus.length, 1);
  assert.equal(toSummary(state).gpuUsagePercent, 40);
  assert.equal("temperatureSensors" in state.latest, false);
});
