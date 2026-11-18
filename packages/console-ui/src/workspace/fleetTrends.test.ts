import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceSummary, OverviewInstanceSeries } from "@dsc/shared";
import { latestPointValue, selectFleetTrends, selectGroupFleetTrends, selectGroupNetworkRates, sumRates } from "./fleetTrends.ts";
import { selectDeviceGroups } from "./selectors.ts";

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

test("selectGroupFleetTrends computes CPU mean, capacity-weighted memory/disk share, and summed network throughput", () => {
  const devices = [
    device({ deviceId: "pve1", hostname: "pve1", group: "宿主机", memoryTotalBytes: 100, diskTotalBytes: 1000 }),
    device({ deviceId: "pve2", hostname: "pve2", group: "宿主机", memoryTotalBytes: 300, diskTotalBytes: 3000 }),
    device({ deviceId: "off1", hostname: "off1", group: "灾备组", status: "offline", memoryTotalBytes: 100, diskTotalBytes: 1000 })
  ];
  const groups = selectDeviceGroups(devices);
  const instances = [
    instance({
      deviceId: "pve1",
      hostname: "pve1",
      cpuUsagePercent: [at(1, 20)],
      memoryUsedBytes: [at(1, 50)],
      diskUsedBytes: [at(1, 500)],
      networkRxBytesPerSec: [at(1, 100)],
      networkTxBytesPerSec: [at(1, 20)]
    }),
    instance({
      deviceId: "pve2",
      hostname: "pve2",
      cpuUsagePercent: [at(1, 60)],
      memoryUsedBytes: [at(1, 90)],
      diskUsedBytes: [at(1, 1500)],
      networkRxBytesPerSec: [at(1, 300)],
      networkTxBytesPerSec: [at(1, 80)]
    }),
    instance({
      deviceId: "off1",
      hostname: "off1",
      cpuUsagePercent: [at(1, 15)]
    })
  ];

  const cpuGroups = selectGroupFleetTrends(instances, groups, "cpu");
  assert.equal(cpuGroups.percent, true);
  assert.equal(cpuGroups.trends[0].points[0].value, 40, "online CPU mean is (20 + 60) / 2 = 40");
  assert.equal(cpuGroups.trends[1].offline, true, "all-offline group retains historical curve marked offline");

  // Capacity-weighted memory: (50 + 90) / (100 + 300) = 140 / 400 = 35% (NOT simple mean (50% + 30%)/2 = 40%!)
  const memGroups = selectGroupFleetTrends(instances, groups, "memory");
  assert.equal(memGroups.trends[0].points[0].value, 35);

  const netGroups = selectGroupFleetTrends(instances, groups, "network");
  assert.equal(netGroups.percent, false);
  assert.equal(netGroups.trends[0].points[0].value, 500, "summed rx+tx across group members");

  const netRates = selectGroupNetworkRates(instances, groups);
  assert.deepEqual(netRates.get("宿主机"), {
    rxBytesPerSec: 400,
    txBytesPerSec: 100,
    totalBytesPerSec: 500,
    reportingCount: 2
  });
});
