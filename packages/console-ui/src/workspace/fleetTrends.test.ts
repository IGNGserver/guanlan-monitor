import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceSummary, OverviewInstanceSeries } from "@dsc/shared";
import { latestPointValue, selectFleetTrends, sumRates } from "./fleetTrends.ts";

const at = (minute: number, value: number) => ({ timestamp: `2026-10-18T10:0${minute}:00.000Z`, value });

function device(overrides: Partial<DeviceSummary>): DeviceSummary {
  return {
    deviceId: "a", hostname: "A", os: "linux", agentVersion: null, agentChannel: null, status: "online",
    lastSeenAt: null, cpuUsagePercent: 10, gpuUsagePercent: null, gpuMemoryUsagePercent: null,
    memoryUsagePercent: 50, diskUsagePercent: 50, memoryTotalBytes: 64, diskTotalBytes: 1000, ...overrides
  };
}

function instance(overrides: Partial<OverviewInstanceSeries>): OverviewInstanceSeries {
  return {
    deviceId: "a", hostname: "A", cpuUsagePercent: [at(1, 20)], memoryUsedBytes: [at(1, 48)], diskUsedBytes: [at(1, 850)],
    networkRxBytesPerSec: [at(1, 100), at(2, 50)], networkTxBytesPerSec: [at(1, 10)], ...overrides
  };
}

test("memory and disk are compared as each device's own share, not as bytes", () => {
  const devices = [device({}), device({ deviceId: "b", hostname: "B", memoryTotalBytes: 256 })];
  const instances = [instance({}), instance({ deviceId: "b", hostname: "B", memoryUsedBytes: [at(1, 48)] })];
  const memory = selectFleetTrends(instances, devices, "memory");
  assert.equal(memory.percent, true);
  assert.deepEqual(memory.trends.map((trend) => [trend.hostname, trend.points[0].value]), [["A", 75], ["B", 18.75]]);
  assert.deepEqual(selectFleetTrends(instances, devices, "disk").trends.map((trend) => trend.points[0].value), [85, 85]);
});

test("a device without a known capacity is named, not drawn at a guessed share", () => {
  const selection = selectFleetTrends([instance({})], [device({ diskTotalBytes: null })], "disk");
  assert.deepEqual(selection.trends, []);
  assert.deepEqual(selection.missingCapacity, ["A"]);
});

test("network is one line per device: receive plus send", () => {
  const selection = selectFleetTrends([instance({})], [device({})], "network");
  assert.equal(selection.percent, false);
  assert.deepEqual(selection.trends[0].points.map((point) => point.value), [110, 50]);
  assert.deepEqual(sumRates([at(2, 1)], [at(1, 2)]).map((point) => point.timestamp), [at(1, 0).timestamp, at(2, 0).timestamp]);
});

test("an offline device keeps its history but is marked as such", () => {
  const selection = selectFleetTrends([instance({})], [device({ status: "offline" })], "cpu");
  assert.equal(selection.trends[0].offline, true);
  assert.equal(selection.trends[0].points.length, 1);
});

test("a metric the device cannot report stays an empty line", () => {
  const selection = selectFleetTrends([instance({ unavailableMetrics: ["cpuUsage"] })], [device({})], "cpu");
  assert.deepEqual(selection.trends[0].points, []);
});

test("the latest reading skips trailing gaps", () => {
  assert.equal(latestPointValue([at(1, 5), at(2, Number.NaN)]), 5);
  assert.equal(latestPointValue([]), null);
});
