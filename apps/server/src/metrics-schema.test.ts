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

test("accepts and preserves the collector self-reporting fields", () => {
  const payload = {
    ...validPayload(),
    probeSpawns: { powershell: 2, "netsh.exe": 1 },
    collectorStats: { slowRuns: 4, slowOverruns: 0, lastSlowMillis: 1200 }
  };
  const result = agentMetricsPayloadSchema.safeParse(payload);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.probeSpawns, { powershell: 2, "netsh.exe": 1 });
  assert.deepEqual(result.data.collectorStats, { slowRuns: 4, slowOverruns: 0, lastSlowMillis: 1200 });
});

test("rejects oversized or malformed collector self-reporting fields", () => {
  const tooManyKeys = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`probe-${index}`, 1]));
  assert.equal(agentMetricsPayloadSchema.safeParse({ ...validPayload(), probeSpawns: tooManyKeys }).success, false);
  assert.equal(agentMetricsPayloadSchema.safeParse({ ...validPayload(), collectorStats: { slowRuns: -1, slowOverruns: 0, lastSlowMillis: 0 } }).success, false);
});

test("accepts sensor observation times and distinguishes unavailable RPM from zero", () => {
  const payload = validPayload();
  const result = agentMetricsPayloadSchema.safeParse({
    ...payload,
    hardwareSampledAt: payload.timestamp,
    cpuTemperatureSampledAt: payload.timestamp,
    fans: [
      { id: "fan-stopped", label: "Fan 1", interface: "hwmon", rpm: 0 },
      { id: "fan-unreadable", label: "Fan 2", interface: "hwmon", rpm: 0, rpmStatus: "unavailable" }
    ],
    temperatureSensors: [{
      id: "cpu-temp", source: "linux-hwmon", rawName: "Tdie", role: "cpu_package",
      currentC: 55, observedAt: payload.timestamp, status: "valid", confidence: "direct"
    }]
  });
  assert.equal(result.success, true);
});

test("strips virtualization fields from legacy agent payloads", () => {
  const payload = validPayload() as ReturnType<typeof validPayload> & Record<string, unknown>;
  payload.identity = {
    ...payload.identity,
    instanceType: "virtual_machine",
    hostDeviceId: "host-1",
    hostName: "host-1",
    virtualMachine: { vmId: "vm:old", platform: "proxmox" }
  } as typeof payload.identity;
  payload.virtualization = { platform: "proxmox", vms: [{ id: "vm-1" }] };
  payload.storagePools = [{ id: "legacy-pool" }];

  const result = agentMetricsPayloadSchema.safeParse(payload);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal("virtualization" in result.data, false);
  assert.equal("storagePools" in result.data, false);
  assert.equal("instanceType" in result.data.identity, false);
  assert.equal("hostDeviceId" in result.data.identity, false);
  assert.equal("hostName" in result.data.identity, false);
  assert.equal("virtualMachine" in result.data.identity, false);
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
