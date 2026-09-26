import test from "node:test";
import assert from "node:assert/strict";
import type { ConsoleSnapshot, DeviceSummary } from "@dsc/shared";
import { selectAttentionDevices, selectDeviceDirectory, selectHealthSummary, selectResourceRanking, selectSnapshotSource } from "./selectors.ts";
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

test("health summary counts offline devices and leaves cached status unknown", () => {
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
    device({ deviceId: "b", hostname: "服务器", cpuUsagePercent: 90, sortOrder: 2 }),
    device({ deviceId: "c", hostname: "离线 NAS", status: "offline", cpuUsagePercent: 99, sortOrder: 3 })
  ];
  assert.deepEqual(selectDeviceDirectory(devices, { query: "服务器" }).map((item) => item.deviceId), ["b"]);
  assert.deepEqual(selectDeviceDirectory(devices, { status: "offline" }).map((item) => item.deviceId), ["c"]);
  assert.deepEqual(selectResourceRanking(devices, "cpu").map((item) => item.deviceId), ["b", "a"]);
});

// The overview surfaces only what cannot answer for itself; the device directory
// stays the single place that lists the whole fleet.
test("attention list keeps offline devices and drops the healthy ones", () => {
  const devices = [
    device({ deviceId: "healthy", sortOrder: 0 }),
    device({ deviceId: "offline", status: "offline", sortOrder: 1 }),
    device({ deviceId: "healthy-2", sortOrder: 2 }),
    device({ deviceId: "offline-early", status: "offline", sortOrder: 3 })
  ];
  assert.deepEqual(selectAttentionDevices(devices).map((item) => item.deviceId), ["offline", "offline-early"]);
  assert.deepEqual(selectAttentionDevices(devices, 1).map((item) => item.deviceId), ["offline"], "the limit must keep the directory order");
  assert.deepEqual(selectAttentionDevices([device({})]), [], "a fully healthy fleet leaves nothing to surface");
});


test("selectSnapshotSource handles live, cache, empty, and unknown correctly", () => {
  const devices = [device({ deviceId: "d1" })];
  assert.equal(selectSnapshotSource({ ...snapshot, source: "cache" }, devices), "cache");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "cache" }, []), "cache");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: true, accessKeyConfigured: true } }, devices), "live");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: true, accessKeyConfigured: true }, overviewMetrics: null }, []), "empty");
  assert.equal(selectSnapshotSource({
    ...snapshot,
    source: "live",
    session: { authenticated: true, accessKeyConfigured: true },
    overviewMetrics: { instances: [{ deviceId: "d1", hostname: "workstation", cpuUsagePercent: [], memoryUsedBytes: [], diskUsedBytes: [], networkRxBytesPerSec: [], networkTxBytesPerSec: [] }] }
  }, []), "live");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "live", session: { authenticated: false, accessKeyConfigured: false } }, devices), "unknown");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "empty" }, []), "empty");
  assert.equal(selectSnapshotSource({ ...snapshot, source: "empty" }, devices), "empty");
});

test("mergeDeviceOrder handles conflict, additions, and deletions", () => {
  const serverOrder = ["A", "B", "C", "D"];
  assert.deepEqual(mergeDeviceOrder(["C", "A", "D", "B"], serverOrder), ["C", "A", "D", "B"]);
  assert.deepEqual(mergeDeviceOrder(["C", "X", "A", "B"], ["A", "B", "C"]), ["C", "A", "B"]);
  assert.deepEqual(mergeDeviceOrder(["B", "A"], ["A", "B", "E"]), ["B", "A", "E"]);
  assert.deepEqual(mergeDeviceOrder(["A", "B"], []), []);
  assert.deepEqual(mergeDeviceOrder([], ["A", "B"]), ["A", "B"]);
});

test("deviceOrderDraft guard registration and confirmation", () => {
  assert.equal(confirmDiscardDeviceOrderDraft(), true);
  const originalConfirm = (globalThis as any).window?.confirm;
  let confirmCalled = 0;
  let confirmReturn = true;
  if (!(globalThis as any).window) (globalThis as any).window = {};
  (globalThis as any).window.confirm = () => { confirmCalled++; return confirmReturn; };
  try {
    let hasDraft = false;
    const unregister = registerDeviceOrderDraftGuard(() => hasDraft);
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 0);
    hasDraft = true;
    confirmReturn = false;
    assert.equal(confirmDiscardDeviceOrderDraft(), false);
    assert.equal(confirmCalled, 1);
    confirmReturn = true;
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 2);
    unregister();
    assert.equal(confirmDiscardDeviceOrderDraft(), true);
    assert.equal(confirmCalled, 2);
  } finally {
    if (originalConfirm) (globalThis as any).window.confirm = originalConfirm;
    else delete (globalThis as any).window.confirm;
  }
});
