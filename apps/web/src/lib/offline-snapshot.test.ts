import assert from "node:assert/strict";
import test from "node:test";
import type { ConsoleSnapshot, MetricsResponse } from "@dsc/shared";
import { readonlySnapshot, restoreSnapshotView, saveSnapshotView, SNAPSHOT_LIMIT, SNAPSHOT_TTL_MS } from "./offline-snapshot.ts";
const now = Date.parse("2026-10-03T00:00:00Z");
function snapshot(id = "a", window: "5m" | "1h" = "5m"): ConsoleSnapshot {
  return {
    generatedAt: "2026-10-02T23:00:00Z", source: "live",
    session: { authenticated: true, accessKeyConfigured: true }, cache: { available: false, savedAt: null, ageSeconds: null },
    localBackend: { config: { secret: "must-not-persist" } } as unknown as ConsoleSnapshot["localBackend"],
    startup: { openAtLogin: true, startMinimized: true },
    devices: [{ deviceId: "a", hostname: "A", status: "online" }, { deviceId: "b", hostname: "B", status: "offline" }] as ConsoleSnapshot["devices"],
    selectedDeviceId: id,
    metrics: { device: { deviceId: id }, window } as MetricsResponse,
    overviewMetrics: { window, instances: [] }, trafficCalendar: null, update: null
  };
}
test("a restored view is read-only and preserves actual data time", () => {
  const restored = readonlySnapshot(snapshot(), new Date(now).toISOString(), now + 5000);
  assert.equal(restored.generatedAt, "2026-10-02T23:00:00Z");
  assert.equal(restored.source, "cache");
  assert.equal(restored.cache.ageSeconds, 5);
  assert.equal(restored.localBackend, null);
  assert.equal(restored.session.authenticated, false);
  assert.equal(restored.session.accessKeyConfigured, false);
  assert.deepEqual(restored.startup, { openAtLogin: false, startMinimized: false });
  assert.ok(!JSON.stringify(restored).includes("must-not-persist"));
});
test("device/window changes never borrow another view's telemetry", () => {
  let saved = saveSnapshotView(null, "session-1", snapshot("a"), { metricWindow: "5m" }, now);
  saved = saveSnapshotView(saved, "session-1", snapshot("b", "1h"), { metricWindow: "1h" }, now + 1);
  assert.equal(restoreSnapshotView(saved, { selectedDeviceId: "a", metricWindow: "5m" }, now + 2)?.metrics?.device.deviceId, "a");
  assert.equal(restoreSnapshotView(saved, { selectedDeviceId: "b", metricWindow: "5m" }, now + 2)?.metrics, null);
  assert.equal(restoreSnapshotView(saved, { selectedDeviceId: "a", metricWindow: "1h" }, now + 2)?.metrics, null);
  assert.equal(restoreSnapshotView(saved, { selectedDeviceId: "missing" }, now + 2)?.metrics, null);
});
test("session changes discard previous account views and cache has an expiry", () => {
  const first = saveSnapshotView(null, "session-1", snapshot("a"), {}, now);
  const next = saveSnapshotView(first, "session-2", snapshot("b"), {}, now);
  assert.equal(next.views.length, 1);
  assert.equal(restoreSnapshotView(next, { selectedDeviceId: "a" }, now)?.metrics, null);
  assert.equal(restoreSnapshotView(next, {}, now + SNAPSHOT_TTL_MS + 1), null);
  assert.equal(restoreSnapshotView(next, {}, now - 1), null);
});
test("old calendar periods are not substituted, and cache size is bounded", () => {
  let saved = saveSnapshotView(null, "session-1", { ...snapshot(), trafficCalendar: { marker: "old-period" } as unknown as ConsoleSnapshot["trafficCalendar"] }, { trafficMode: "day", trafficAnchor: "2026-10-02T00:00:00Z" }, now);
  assert.equal(restoreSnapshotView(saved, { trafficMode: "day", trafficAnchor: "2026-10-03T00:00:00Z" }, now)?.trafficCalendar, null);
  for (let i = 0; i < 30; i++) saved = saveSnapshotView(saved, "session-1", snapshot(String(i)), {}, now + i);
  assert.equal(saved.views.length, SNAPSHOT_LIMIT);
  assert.equal(saved.views[0].snapshot.selectedDeviceId, "29");
});

test("a multibyte payload cannot exceed the serialized cache budget", () => {
  const large = { ...snapshot(), metrics: { ...snapshot().metrics, note: "观".repeat(1_400_000) } } as ConsoleSnapshot;
  const saved = saveSnapshotView(null, "session-1", large, {}, now);
  assert.ok(new TextEncoder().encode(JSON.stringify(saved)).byteLength <= 4_000_000);
  assert.equal(saved.views[0].snapshot.metrics, null);
  const hugeSummary = { ...snapshot(), devices: [{ ...snapshot().devices[0], hostname: "观".repeat(1_400_000) }] };
  assert.equal(restoreSnapshotView(saveSnapshotView(null, "session-1", hugeSummary, {}, now), {}, now), null);
});
test("a malformed local cache is ignored without preventing live startup", () => {
  const broken = { schema: 1, scope: "session-1", views: [null, { savedAt: new Date(now).toISOString() }] };
  assert.equal(restoreSnapshotView(broken as unknown as Parameters<typeof restoreSnapshotView>[0], {}, now), null);
});
