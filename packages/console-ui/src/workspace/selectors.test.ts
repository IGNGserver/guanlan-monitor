import test from "node:test";
import assert from "node:assert/strict";
import type { ConsoleSnapshot, DeviceSummary } from "@dsc/shared";
import { selectDeviceDirectory, selectHealthSummary, selectOverviewDevices, selectResourceRanking } from "./selectors.ts";

const device = (overrides: Partial<DeviceSummary>): DeviceSummary => ({
  deviceId: "device-1",
  hostname: "工作站",
  os: "linux",
  agentVersion: "3.0.1",
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
    hostTotal: 2,
    hostOnline: 1,
    virtualMachineTotal: 0,
    virtualMachineOnline: 0,
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

test("health summary is global even when a page has an instance-type view", () => {
  const devices = [
    device({ deviceId: "host", instanceType: "device" }),
    device({ deviceId: "vm", hostname: "VM", instanceType: "virtual_machine", status: "offline", virtualMachine: { vmId: "vm", platform: "proxmox", node: "pve", type: "qemu", powerState: "stopped", hostName: "host" } })
  ];
  const health = selectHealthSummary(snapshot, devices, () => "10:00");
  assert.equal(health.total, 2);
  assert.equal(health.hostTotal, 1);
  assert.equal(health.virtualMachineTotal, 1);
  assert.equal(health.offline, 1);
  assert.equal(health.pending, 1);
});

test("health pending count remains global when the abnormal instance changes type", () => {
  const hostOfflineVmOnline = [
    device({ deviceId: "host", status: "offline" }),
    device({ deviceId: "vm", hostname: "VM", instanceType: "virtual_machine", virtualMachine: { vmId: "vm", platform: "proxmox", powerState: "running" } })
  ];
  const hostOnlineVmOffline = [
    device({ deviceId: "host" }),
    device({ deviceId: "vm", hostname: "VM", instanceType: "virtual_machine", status: "offline", virtualMachine: { vmId: "vm", platform: "proxmox", powerState: "stopped" } })
  ];
  const first = selectHealthSummary(snapshot, hostOfflineVmOnline, () => "10:00");
  const second = selectHealthSummary(snapshot, hostOnlineVmOffline, () => "10:00");
  assert.deepEqual(
    { total: first.total, online: first.online, offline: first.offline, pending: first.pending },
    { total: second.total, online: second.online, offline: second.offline, pending: second.pending }
  );
});

test("overview puts attention items before healthy devices without changing server order", () => {
  const devices = [
    device({ deviceId: "healthy", sortOrder: 0 }),
    device({ deviceId: "offline", status: "offline", sortOrder: 1 }),
    device({ deviceId: "stopped-vm", instanceType: "virtual_machine", status: "online", sortOrder: 2, virtualMachine: { vmId: "stopped-vm", platform: "proxmox", powerState: "stopped" } })
  ];
  assert.deepEqual(selectOverviewDevices(devices).map((item) => item.deviceId), ["offline", "stopped-vm", "healthy"]);
});
