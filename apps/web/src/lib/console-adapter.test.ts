import assert from "node:assert/strict";
import test from "node:test";
import { WebConsoleAdapter, resolveInclude } from "./console-adapter.ts";

const device = {
  deviceId: "nas", hostname: "nas", os: "linux", agentVersion: "1.0.0", agentChannel: "test", status: "online",
  lastSeenAt: "2026-10-04T00:00:00.000Z", cpuUsagePercent: 10, gpuUsagePercent: null, gpuMemoryUsagePercent: null,
  memoryUsagePercent: 20, diskUsagePercent: 30
};
const metrics = {
  device, window: "5m", lastSeenAt: device.lastSeenAt, rangeEnd: device.lastSeenAt,
  latest: {}, series: {}
};

/** Route every hub read to a canned body and record which endpoints were hit. */
function installHub() {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // Outside a browser the client prefixes the hub origin; match on the path.
    const path = new URL(String(input), "http://hub.invalid").pathname;
    calls.push(path);
    const body = path === "/api/auth/session" ? { ok: true, issuedAt: "scope-1" }
      : path === "/api/instances" ? [device]
      : path.endsWith("/metrics") ? metrics
      : path === "/api/overview/metrics" ? { window: "5m", instances: [] }
      : path.endsWith("/traffic-calendar") ? { cells: [] }
      : path === "/api/updates" ? { available: false }
      : {};
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function adapterAt(clock: { now: number }) {
  const adapter = new WebConsoleAdapter();
  adapter.now = () => clock.now;
  return adapter;
}

test("an omitted include still reads everything for older callers", () => {
  assert.deepEqual(resolveInclude(undefined), { deviceMetrics: true, overviewMetrics: true, trafficCalendar: true });
  assert.deepEqual(resolveInclude({ overviewMetrics: true }), { deviceMetrics: false, overviewMetrics: true, trafficCalendar: false });
});

test("the overview reads the fleet and its trend, not a device history", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    const snapshot = await adapter.refresh({ include: { overviewMetrics: true } });
    assert.equal(snapshot.devices.length, 1);
    assert.ok(hub.calls.includes("/api/overview/metrics"));
    assert.equal(hub.calls.filter((path) => path.endsWith("/metrics") && path !== "/api/overview/metrics").length, 0, "no device history on the overview");
    assert.equal(hub.calls.filter((path) => path.endsWith("/traffic-calendar")).length, 0, "no traffic calendar on the overview");
  } finally { hub.restore(); }
});

test("a poll inside the budget skips the session check and slow resources", async () => {
  const hub = installHub();
  const clock = { now: 1_000_000 };
  try {
    const adapter = adapterAt(clock);
    const request = { selectedDeviceId: "nas", include: { deviceMetrics: true, trafficCalendar: true } };
    const poll = { ...request, background: true };
    await adapter.refresh(request);
    const first = hub.calls.splice(0);
    assert.deepEqual(first.filter((path) => path === "/api/auth/session").length, 1);
    assert.ok(first.includes("/api/devices/nas/metrics"));
    assert.ok(first.includes("/api/devices/nas/traffic-calendar"));
    assert.ok(first.includes("/api/updates"));

    clock.now += 10_000;
    await adapter.refresh(poll);
    assert.deepEqual(hub.calls.splice(0).sort(), ["/api/devices/nas/metrics", "/api/instances"], "a 10 s poll reads only what changes that fast");

    clock.now += 60_000;
    await adapter.refresh(poll);
    const later = hub.calls.splice(0);
    assert.ok(later.includes("/api/auth/session"), "the session is re-confirmed once its budget lapses");
    assert.ok(later.includes("/api/devices/nas/traffic-calendar"), "the calendar is re-read after its TTL");
    assert.ok(!later.includes("/api/updates"), "update info keeps its longer TTL");
  } finally { hub.restore(); }
});

test("a user refresh always re-confirms the session, even inside the budget", async () => {
  const hub = installHub();
  const clock = { now: 1_000_000 };
  try {
    const adapter = adapterAt(clock);
    await adapter.refresh({ include: {} });
    hub.calls.splice(0);
    clock.now += 2_000;
    await adapter.refresh({ include: {} });
    assert.ok(hub.calls.includes("/api/auth/session"), "only background polls may skip the session check");
  } finally { hub.restore(); }
});

test("views that do not draw a resource keep its last payload", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    await adapter.refresh({ selectedDeviceId: "nas", include: { deviceMetrics: true } });
    const directory = await adapter.refresh({ include: {} });
    assert.equal(directory.metrics?.device.deviceId, "nas", "the device page's history survives a visit to the directory");
  } finally { hub.restore(); }
});

test("a 401 on a data read still expires the session at once", async () => {
  const hub = installHub();
  const clock = { now: 1_000_000 };
  try {
    const adapter = adapterAt(clock);
    await adapter.refresh({ include: {} });
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => new URL(String(input), "http://hub.invalid").pathname === "/api/instances"
      ? new Response("{}", { status: 401 })
      : original(input)) as typeof fetch;
    clock.now += 5_000;
    await assert.rejects(adapter.refresh({ include: {}, background: true }), (error: unknown) => (error as { status?: number }).status === 401);
  } finally { hub.restore(); }
});
