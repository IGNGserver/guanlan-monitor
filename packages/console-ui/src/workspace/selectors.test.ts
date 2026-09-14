import test from "node:test";
import assert from "node:assert/strict";
import type { ConsoleSnapshot, DeviceSummary } from "@dsc/shared";
import { selectDeviceDirectory, selectHealthSummary, selectOverviewDevices, selectResourceRanking, selectSnapshotSource } from "./selectors.ts";
import { mergeDeviceOrder, registerDeviceOrderDraftGuard, confirmDiscardDeviceOrderDraft } from "./deviceOrderDraft.ts";

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

test("selectSnapshotSource handles live, cache, empty, and unknown correctly", () => {
  const devices = [device({ deviceId: "d1" })];

  // cache snapshot always yields 'cache' regardless of devices
  assert.equal(selectSnapshotSource({ ...snapshot, source: "cache" }, devices), "cache");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "cache" }, []), "cache");

  // live snapshot with authenticated session and devices yields 'live'
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: true, accessKeyConfigured: true } }, devices), "live");

  // live snapshot with authenticated session but no devices and no overview metrics yields 'empty'
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: true, accessKeyConfigured: true }, overviewMetrics: null }, []), "empty");

  // live snapshot with overview instances even if devices empty yields 'live'
  assert.equal(selectSnapshotSource({
    ...snapshot,
    source: "live",
    session: { authenticated: true, accessKeyConfigured: true },
    overviewMetrics: { instances: [{ deviceId: "d1", hostname: "vm", cpuUsagePercent: [], memoryUsedBytes: [], diskUsedBytes: [], networkRxBytesPerSec: [], networkTxBytesPerSec: [] }] }
  }, []), "live");

  // live snapshot not authenticated yields 'unknown'
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: false, accessKeyConfigured: false } }, devices), "unknown");

  // snapshot with explicit 'empty' source yields 'empty'
  assert.equal(selectSnapshotSource({ ...snapshot, source: "empty" }, []), "empty");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "empty" }, devices), "empty");
});

test("VM powerState 4x2 matrix (stopped, paused, suspended, unknown x online/offline) behavior in health and directory", () => {
  const powerStates = ["stopped", "paused", "suspended", "unknown"] as const;
  const agentStatuses = ["online", "offline"] as const;

  for (const power of powerStates) {
    for (const agentStatus of agentStatuses) {
      const vmDevice = device({
        deviceId: `vm-${power}-${agentStatus}`,
        instanceType: "virtual_machine",
        status: agentStatus,
        virtualMachine: {
          vmId: `vm-${power}`,
          platform: "proxmox",
          node: "pve1",
          type: "qemu",
          powerState: power
        }
      });

      const health = selectHealthSummary(snapshot, [vmDevice], () => "10:00");
      assert.equal(health.total, 1, `total for ${power}/${agentStatus}`);
      assert.equal(health.virtualMachineTotal, 1, `vm total for ${power}/${agentStatus}`);
      if (agentStatus === "online") {
        assert.equal(health.online, 1);
        assert.equal(health.offline, 0);
      } else {
        assert.equal(health.online, 0);
        assert.equal(health.offline, 1);
      }

      // In all these 4 power states, none is "running".
      // When agentStatus is online, since powerState is not running, unhealthyDevices must be 1 => pending must be 1.
      // When agentStatus is offline, status is not online => unhealthyDevices must be 1 => pending must be 1.
      assert.equal(health.pending, 1, `pending count for abnormal VM ${power}/${agentStatus} must be 1`);

      // Verify directory query filters
      const dirAll = selectDeviceDirectory([vmDevice], { instanceType: "virtual_machine" });
      assert.equal(dirAll.length, 1);
      const dirOnline = selectDeviceDirectory([vmDevice], { instanceType: "virtual_machine", status: "online" });
      assert.equal(dirOnline.length, agentStatus === "online" ? 1 : 0);
      const dirOffline = selectDeviceDirectory([vmDevice], { instanceType: "virtual_machine", status: "offline" });
      assert.equal(dirOffline.length, agentStatus === "offline" ? 1 : 0);

      // Verify overview ranking puts abnormal VM before healthy host
      const hostHealthy = device({ deviceId: "host-normal", status: "online" });
      const overview = selectOverviewDevices([hostHealthy, vmDevice]);
      assert.equal(overview[0].deviceId, vmDevice.deviceId, `overview should prioritize attention VM ${power}/${agentStatus}`);
    }
  }

  // Also verify a healthy running online VM has pending 0
  const runningOnlineVm = device({
    deviceId: "vm-running-online",
    instanceType: "virtual_machine",
    status: "online",
    virtualMachine: { vmId: "vm-1", platform: "proxmox", powerState: "running" }
  });
  const healthyHealth = selectHealthSummary(snapshot, [runningOnlineVm], () => "10:00");
  assert.equal(healthyHealth.pending, 0);
});

test("mergeDeviceOrder handles conflict, additions, and deletions", () => {
  // Server order is [A, B, C, D]
  const serverOrder = ["A", "B", "C", "D"];

  // 1. Reordering without add/delete
  const reorderedDraft = ["C", "A", "D", "B"];
  assert.deepEqual(mergeDeviceOrder(reorderedDraft, serverOrder), ["C", "A", "D", "B"]);

  // 2. Draft contains deleted device X; server only has [A, B, C]
  const draftWithDeleted = ["C", "X", "A", "B"];
  assert.deepEqual(mergeDeviceOrder(draftWithDeleted, ["A", "B", "C"]), ["C", "A", "B"]);

  // 3. Server has newly discovered device E not present in draft
  const draftWithoutNew = ["B", "A"];
  assert.deepEqual(mergeDeviceOrder(draftWithoutNew, ["A", "B", "E"]), ["B", "A", "E"]);

  // 4. Server empty
  assert.deepEqual(mergeDeviceOrder(["A", "B"], []), []);

  // 5. Draft empty
  assert.deepEqual(mergeDeviceOrder([], ["A", "B"]), ["A", "B"]);
});

test("deviceOrderDraft guard registration and confirmation", () => {
  // Initially no guards registered => confirm returns true without prompting
  assert.equal(confirmDiscardDeviceOrderDraft(), true);

  // Mock window.confirm
  const originalConfirm = (globalThis as any).window?.confirm;
  let confirmCalled = 0;
  let confirmReturn = true;
  if (!(globalThis as any).window) {
    (globalThis as any).window = {};
  }
  (globalThis as any).window.confirm = () => {
    confirmCalled++;
    return confirmReturn;
  };

  try {
    let hasDraft = false;
    const unregister = registerDeviceOrderDraftGuard(() => hasDraft);

    // Guard returns false (no draft) => confirm returns true without prompt
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 0);

    // Guard returns true (draft present) => triggers window.confirm
    hasDraft = true;
    confirmReturn = false;
    assert.equal(confirmDiscardDeviceOrderDraft(), false);
    assert.equal(confirmCalled, 1);

    confirmReturn = true;
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 2);

    // Unregister guard
    unregister();
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 2); // No new call
  } finally {
    if (originalConfirm) {
      (globalThis as any).window.confirm = originalConfirm;
    } else {
      delete (globalThis as any).window.confirm;
    }
  }
});
