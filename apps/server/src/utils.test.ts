import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMetricsPayload } from "@dsc/shared";
import type { DeviceRealtimeState } from "./types.js";
import { getAvailableMetrics, normalizeRealtimeState, payloadToTimeSeries, timeSeriesToMetricSeries, toSummary } from "./utils.js";
import { assetNameFor } from "./update-assets.js";

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

test("explicit metric quality distinguishes valid zero from absent and stale readings", () => {
  const state = stateWith({ metricQuality: { swapUsage: { state: "direct" }, memoryCached: { state: "direct" }, cpuUsage: { state: "stale" }, memoryCommitted: { state: "not_applicable" } } });
  const availability = new Map(getAvailableMetrics(state).map((item) => [item.key, item.available]));
  assert.equal(availability.get("swapUsage"), true);
  assert.equal(availability.get("memoryCached"), true);
  assert.equal(availability.get("cpuUsage"), false);
  assert.equal(availability.get("memoryCommitted"), false);
});

test("macOS installer selection matches architecture and refuses missing/unknown arch", () => {
  assert.equal(assetNameFor("macos-gui", "3.0.151", "arm64"), "DeviceStateConsole-macOS-arm64-Install-v3.0.151.pkg");
  assert.equal(assetNameFor("macos-gui", "3.0.151", "amd64"), "DeviceStateConsole-macOS-x64-Install-v3.0.151.pkg");
  assert.equal(assetNameFor("macos-gui", "3.0.151", "x64"), "DeviceStateConsole-macOS-x64-Install-v3.0.151.pkg");
  assert.equal(assetNameFor("macos-gui", "3.0.151"), null);
  assert.equal(assetNameFor("macos-gui", "3.0.151", "i386"), null);
});

test("explicit unavailable metrics stay out of historical charts while observed zero remains", () => {
  const payload = stateWith({ metricQuality: { cpuUsage: { state: "direct" }, swapUsage: { state: "direct" }, memoryCommitted: { state: "not_applicable" }, gpuUsage: { state: "unavailable" } } }).latest;
  payload.cpuUsagePercent = 0;
  const record = payloadToTimeSeries(payload);
  const series = timeSeriesToMetricSeries([record]);
  assert.deepEqual(series.cpuUsagePercent.map((point) => point.value), [0]);
  assert.deepEqual(series.swapUsagePercent.map((point) => point.value), [0]);
  assert.equal(series.memoryCommittedBytes.length, 0);
  assert.equal(series.gpuUsagePercent.length, 0);
  assert.equal(record.recordedDetails?.metricQuality?.memoryCommitted?.state, "not_applicable");
});

test("unified GPU allocation without a driver budget is not a zero-percent VRAM sample", () => {
  const payload = stateWith({
    metricQuality: { gpuMemory: { state: "direct" } },
    gpus: [{ id: "agx", name: "Apple GPU", utilizationPercent: 0, memoryKind: "unified", memoryUsedBytes: 1024, memoryTotalBytes: 0 }]
  }).latest;
  const series = timeSeriesToMetricSeries([payloadToTimeSeries(payload)]);
  assert.equal(series.gpuMemoryUsagePercent.length, 0);
  assert.equal(series.gpus[0].memoryUsagePercent.length, 0);
  assert.deepEqual(series.gpuMemoryUsedBytes.map((point) => point.value), [1024]);
});

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

test("missing temperature and disabled fan samples leave gaps while observed zero RPM remains", () => {
  const first = stateWith({
    cpuPackages: [{ id: "cpu-0", name: "CPU", temperatureC: 55 }],
    gpus: [{ id: "gpu-0", name: "GPU", utilizationPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 1, temperatureC: 60 }],
    fans: [{ id: "fan-0", label: "Fan", interface: "hwmon", rpm: 0 }]
  }).latest;
  const second = stateWith({
    timestamp: "2026-09-25T00:00:30.000Z",
    cpuPackages: [{ id: "cpu-0", name: "CPU" }],
    gpus: [{ id: "gpu-0", name: "GPU", utilizationPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 1 }],
    fans: [{ id: "fan-0", label: "Fan", interface: "hwmon", rpm: 0, rpmStatus: "disabled" }]
  }).latest;
  const points = [payloadToTimeSeries(first), payloadToTimeSeries(second)];
  const series = timeSeriesToMetricSeries(points);
  assert.deepEqual(series.cpus[0]?.temperatureC.map((point) => point.value), [55]);
  assert.deepEqual(series.gpus[0]?.temperatureC.map((point) => point.value), [60]);
  assert.deepEqual(series.fans[0]?.rpm.map((point) => point.value), [0]);
});

test("a repeated slow hardware observation produces one temperature and RPM point", () => {
  const hardwareSampledAt = "2026-09-25T00:00:00.123Z";
  const first = stateWith({
    hardwareSampledAt,
    cpuTemperatureSampledAt: hardwareSampledAt,
    cpuPackages: [{ id: "cpu-0", name: "CPU", temperatureC: 55 }],
    gpus: [{ id: "gpu-0", name: "GPU", utilizationPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 1, temperatureC: 60 }],
    fans: [{ id: "fan-0", label: "Fan", interface: "hwmon", rpm: 0 }],
    temperatureSensors: [{ id: "temp-0", source: "linux-hwmon", rawName: "Tdie", role: "cpu_package", status: "valid", confidence: "direct", currentC: 55, observedAt: hardwareSampledAt }]
  }).latest;
  const repeated = { ...first, timestamp: "2026-09-25T00:00:30.000Z" };
  const series = timeSeriesToMetricSeries([payloadToTimeSeries(first), payloadToTimeSeries(repeated)]);
  assert.equal(series.cpuTemperatureC.length, 1);
  assert.equal(series.cpus[0]?.temperatureC.length, 1);
  assert.equal(series.gpus[0]?.temperatureC.length, 1);
  assert.deepEqual(series.fans[0]?.rpm, [{ timestamp: hardwareSampledAt, value: 0 }]);
  assert.equal(series.temperatureSensors[0]?.currentC.length, 1);
});
