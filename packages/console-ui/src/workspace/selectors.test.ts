import test from "node:test";
import assert from "node:assert/strict";
import type { ConsoleSnapshot, DeviceSummary } from "@dsc/shared";
import { selectDeviceDirectory, selectHealthSummary, selectResourceRanking } from "./selectors.ts";

const device = (overrides: Partial<DeviceSummary>): DeviceSummary => ({
  deviceId: "device-1",
  hostname: "工作站",
  os: "linux",
  agentVersion: "3.0.0",
  agentChannel: "test",
  status: "online",
  lastSeenAt: "2026-09-13T10:00:00.000Z",
  cpuUsagePercent: 12,
  gpuUsagePercent: null,
  gpuMemoryUsagePercent: null,
  memoryUsagePercent: 42,
  diskUsagePercent: 50,
  sortOrder: 0,
  ...overrides
});

const snapshot: ConsoleSnapshot = {
  generatedAt: "2026-09-13T10:00:00.000Z",
  source: "live",
  cache: { available: false, savedAt: null, ageSeconds: null },
  session: { authenticated: true, accessKeyConfigured: true },
  localBackend: null,
  devices: [],
  selectedDeviceId: null,
  metrics: null,
  overviewMetrics: null,
  trafficCalendar: null,
  update: null,
  startup: { openAtLogin: false, startMinimized: false }
};

test("health summary keeps pending unknown for cache and counts live offline work", () => {
  const devices = [device({}), device({ deviceId: "device-2", hostname: "NAS", status: "offline" })];
  assert.deepEqual(selectHealthSummary(snapshot, devices, () => "10:00"), {
    total: 2,
    online: 1,
    offline: 1,
    pending: 1,
    source: "live",
    sourceLabel: "实时连接",
    sourceDetail: "同步于 10:00"
  });
  assert.equal(selectHealthSummary({ ...snapshot, source: "cache", session: { ...snapshot.session, authenticated: false } }, devices, () => "09:58").pending, null);
});

test("directory filters and resource ranking are deterministic", () => {
  const devices = [
    device({ deviceId: "a", hostname: "工作站", cpuUsagePercent: 20, sortOrder: 1 }),
    device({ deviceId: "b", hostname: "虚拟机", instanceType: "virtual_machine", cpuUsagePercent: 90, sortOrder: 2 }),
    device({ deviceId: "c", hostname: "离线 NAS", status: "offline", cpuUsagePercent: 99, sortOrder: 3 })
  ];
  assert.deepEqual(selectDeviceDirectory(devices, { instanceType: "virtual_machine" }).map((item) => item.deviceId), ["b"]);
  assert.deepEqual(selectDeviceDirectory(devices, { status: "offline" }).map((item) => item.deviceId), ["c"]);
  assert.deepEqual(selectResourceRanking(devices, "cpu").map((item) => item.deviceId), ["b", "a"]);
});
