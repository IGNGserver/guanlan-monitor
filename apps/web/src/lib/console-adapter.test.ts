import assert from "node:assert/strict";
import test from "node:test";
import { WebConsoleAdapter, resolveInclude } from "./console-adapter.ts";
import type { ConsoleSnapshot } from "@dsc/shared";

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
      : path === "/IGNGserver/guanlan-monitor/updates/updates.json" ? { schemaVersion: 1, repository: "IGNGserver/guanlan-monitor", generatedAt: "2026-10-25T12:00:00Z", releases: [] }
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

test("Web release channels are local and never proxy update checks through the Hub", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    await adapter.refresh({ include: {} });
    const before = hub.calls.length;
    const result = await adapter.updateStartupSettings({ updateChannel: "stable" });
    assert.equal(hub.calls.length, before, "saving the release channel performs no Hub write");
    assert.equal(result.startup.updateChannel, "stable");
    assert.equal(result.update?.platform, "web");
    assert.equal(result.update?.assetUrl, null, "Web release metadata must not pretend to manage native installations");
    assert.ok(!hub.calls.includes("/api/updates"));
    assert.ok(hub.calls.includes("/IGNGserver/guanlan-monitor/updates/updates.json"));
  } finally { hub.restore(); }
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
    assert.ok(first.includes("/IGNGserver/guanlan-monitor/updates/updates.json"));

    clock.now += 10_000;
    await adapter.refresh(poll);
    assert.deepEqual(hub.calls.splice(0).sort(), ["/api/devices/nas/metrics", "/api/instances"], "a 10 s poll reads only what changes that fast");

    clock.now += 60_000;
    await adapter.refresh(poll);
    const later = hub.calls.splice(0);
    assert.ok(later.includes("/api/auth/session"), "the session is re-confirmed once its budget lapses");
    assert.ok(later.includes("/api/devices/nas/traffic-calendar"), "the calendar is re-read after its TTL");
    assert.ok(!later.includes("/IGNGserver/guanlan-monitor/updates/updates.json"), "update info keeps its longer TTL");
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

test("live reads survive normal background refresh but are fenced by logout", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    await adapter.refresh({ include: {} });
    const original = globalThis.fetch;
    let release!: (response: Response) => void;
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/live")
      ? new Promise<Response>((resolve) => { release = resolve; }) : original(input)) as typeof fetch;
    const first = adapter.live.getLiveConnection("nas");
    await adapter.refresh({ include: {}, background: true });
    release(new Response(JSON.stringify({ state: "ready", sessionId: "current", capabilities: [], connectedAt: null })));
    assert.equal((await first).state, "ready");
    const stale = adapter.live.getLiveConnection("nas");
    await adapter.logout();
    release(new Response(JSON.stringify({ state: "ready", sessionId: "stale", capabilities: [], connectedAt: null })));
    await assert.rejects(stale, /session_changed/);
    await assert.rejects(adapter.live.getLiveConnection("nas"), /live_session_required/);
  } finally { hub.restore(); }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("bootstrap shares session validation and does not check it again for the first view", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    await Promise.all([adapter.establishSession(), adapter.establishSession()]);
    await adapter.getSnapshot({ include: {} });
    assert.equal(hub.calls.filter((path) => path === "/api/auth/session").length, 1);
    await adapter.refresh({ include: {} });
    assert.equal(hub.calls.filter((path) => path === "/api/auth/session").length, 2, "manual refresh still validates the session");
  } finally { hub.restore(); }
});

test("summary and charts publish independently while calendar and update discovery are stalled", async () => {
  const hub = installHub();
  const metricsRead = deferred<Response>(), calendarRead = deferred<Response>(), updateRead = deferred<Response>();
  const summarySeen = deferred<ConsoleSnapshot>(), metricsSeen = deferred<ConsoleSnapshot>();
  const snapshots: ConsoleSnapshot[] = [];
  let stop = () => {};
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://hub.invalid").pathname;
      if (path === "/IGNGserver/guanlan-monitor/updates/updates.json") return updateRead.promise;
      if (path.endsWith("/traffic-calendar")) return calendarRead.promise;
      if (path.endsWith("/metrics")) return metricsRead.promise;
      return canned(input);
    }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    stop = adapter.subscribe((snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.source === "live") summarySeen.resolve(snapshot);
      if (snapshot.metrics) metricsSeen.resolve(snapshot);
    });
    const loading = adapter.getSnapshot({ selectedDeviceId: "nas", include: { deviceMetrics: true, trafficCalendar: true } });
    const summary = await summarySeen.promise;
    assert.equal(summary.devices.length, 1);
    assert.equal(summary.metrics, null);
    assert.equal(summary.trafficCalendar, null);
    metricsRead.resolve(json(metrics));
    assert.equal((await metricsSeen.promise).metrics?.device.deviceId, "nas");
    calendarRead.resolve(json({ cells: [] }));
    const complete = await loading;
    assert.ok(complete.trafficCalendar);
    assert.equal(complete.update?.latestVersion, null, "a stalled repository feed cannot block refresh or claim a newer Web version");
    assert.ok(snapshots.length >= 3);
  } finally {
    metricsRead.resolve(json(metrics)); calendarRead.resolve(json({ cells: [] })); updateRead.resolve(json({ available: false }));
    stop(); hub.restore();
  }
});

test("a stalled cache write cannot hold back live data or a completed refresh", async () => {
  const hub = installHub();
  const saving = deferred<boolean>(), started = deferred<void>();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    const internals = adapter as unknown as { cache: { save: () => Promise<boolean> } };
    internals.cache.save = () => { started.resolve(); return saving.promise; };
    const result = await adapter.refresh({ include: {} });
    assert.equal(result.source, "live");
    assert.equal(result.devices.length, 1);
    await started.promise;
    await adapter.logout();
    saving.resolve(true);
    await new Promise((done) => setImmediate(done));
    await assert.rejects(adapter.live.getLiveConnection("nas"), /live_session_required/);
  } finally { saving.resolve(false); hub.restore(); }
});

test("late optional results cannot overwrite a newer selection or revive a logged-out session", async () => {
  const hub = installHub();
  const slow = deferred<Response>(), begun = deferred<void>();
  let stop = () => {};
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/devices/old/metrics")) { begun.resolve(); return slow.promise; }
      return canned(input);
    }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    let latest: ConsoleSnapshot | null = null;
    stop = adapter.subscribe((snapshot) => { latest = snapshot; });
    const old = adapter.getSnapshot({ selectedDeviceId: "old", include: { deviceMetrics: true } });
    await begun.promise;
    await adapter.getSnapshot({ selectedDeviceId: "nas", include: { deviceMetrics: true } });
    await adapter.logout();
    slow.resolve(json({ ...metrics, device: { ...device, deviceId: "old" } }));
    await old;
    assert.equal((latest as ConsoleSnapshot | null)?.source, "empty");
    assert.equal((latest as ConsoleSnapshot | null)?.metrics, null);
  } finally { slow.resolve(json(metrics)); stop(); hub.restore(); }
});

test("an optional endpoint 403 clears an already-published summary", async () => {
  const hub = installHub();
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/traffic-calendar")
      ? json({}, 403) : canned(input)) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    await assert.rejects(adapter.getSnapshot({ selectedDeviceId: "nas", include: { trafficCalendar: true } }), (error: unknown) => (error as { status?: number }).status === 403);
    await assert.rejects(adapter.live.getLiveConnection("nas"), /live_session_required/);
  } finally { hub.restore(); }
});

test("an in-flight bootstrap validation cannot survive logout", async () => {
  const hub = installHub();
  const session = deferred<Response>(), begun = deferred<void>();
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/session")) { begun.resolve(); return session.promise; }
      return canned(input);
    }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    const validating = adapter.establishSession();
    const rejected = assert.rejects(validating, /session_changed/);
    await begun.promise;
    await adapter.logout();
    session.resolve(json({ ok: true, issuedAt: "old-scope" }));
    await rejected;
    await assert.rejects(adapter.live.getLiveConnection("nas"), /live_session_required/);
  } finally { session.resolve(json({ ok: true, issuedAt: "old-scope" })); hub.restore(); }
});

test("successful deferred cache writes remain throttled on unchanged polls", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    let writes = 0;
    const saved = deferred<void>();
    const internals = adapter as unknown as { cache: { save: () => Promise<boolean> } };
    internals.cache.save = async () => { writes++; return true; };
    const stop = adapter.subscribe((snapshot) => { if (snapshot.cache.available) saved.resolve(); });
    try {
      await adapter.refresh({ include: {} });
      await saved.promise;
      assert.equal(writes, 1);
      await adapter.refresh({ include: {}, background: true });
      // Drain the deferred cache timer, not a latency assertion.
      await new Promise((done) => setTimeout(done, 10));
      assert.equal(writes, 1);
    } finally { stop(); }
  } finally { hub.restore(); }
});

test("explicit network recovery supersedes a pending session validation and ignores its stale 401", async () => {
  const hub = installHub();
  const stale = deferred<Response>();
  try {
    const canned = globalThis.fetch;
    let sessions = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/auth/session") && ++sessions === 1) return stale.promise;
      return canned(input);
    }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    const old = adapter.establishSession();
    const rejected = assert.rejects(old, (error: unknown) => (error as { status?: number }).status === 401);
    await adapter.establishSession(true);
    await adapter.getSnapshot({ include: {} });
    stale.resolve(json({}, 401));
    await rejected;
    assert.equal(sessions, 2, "recovery must dispatch a newer validation, not share pre-recovery work");
    assert.equal((await adapter.getSnapshot({ include: {} })).source, "live");
    assert.equal((await adapter.live.getLiveConnection("nas")) != null, true);
  } finally { stale.resolve(json({}, 401)); hub.restore(); }
});

test("a new selection aborts obsolete reads without waiting for their transport or timeout", async () => {
  const hub = installHub();
  const held = deferred<Response>(), begun = deferred<void>();
  let obsoleteSignal: AbortSignal | null = null;
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/devices/old/metrics")) { obsoleteSignal = init?.signal ?? null; begun.resolve(); return held.promise; }
      return canned(input, init);
    }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    const old = adapter.getSnapshot({ selectedDeviceId: "old", include: { deviceMetrics: true } });
    await begun.promise;
    const next = await adapter.getSnapshot({ selectedDeviceId: "nas", include: { deviceMetrics: true } });
    assert.equal((obsoleteSignal as AbortSignal | null)?.aborted, true);
    assert.equal(next.metrics?.device.deviceId, "nas");
    await old;
  } finally { held.resolve(json(metrics)); hub.restore(); }
});

test("saver requests a point target, standard opts out, and summary failure backoff recovers", async () => {
  const hub = installHub();
  try {
    const canned = globalThis.fetch;
    const urls: URL[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { urls.push(new URL(String(input))); return canned(input, init); }) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    await adapter.getSnapshot({ selectedDeviceId: "nas", include: { deviceMetrics: true }, networkMode: "saver" });
    assert.equal(urls.find((url) => url.pathname === "/api/devices/nas/metrics")?.searchParams.get("pointBudget"), "120");
    assert.equal(adapter.getRefreshDelay(10000), 30000);
    urls.splice(0);
    await adapter.getSnapshot({ selectedDeviceId: "nas", include: { deviceMetrics: true }, networkMode: "standard" });
    assert.equal(urls.find((url) => url.pathname === "/api/devices/nas/metrics")?.searchParams.has("pointBudget"), false);
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).endsWith("/api/instances") ? json({}, 503) : canned(input)) as typeof fetch;
    for (let i = 0; i < 3; i++) await assert.rejects(adapter.refresh({ include: {}, networkMode: "standard" }));
    assert.equal(adapter.getRefreshDelay(10000), 80000);
    globalThis.fetch = canned;
    await adapter.refresh({ include: {}, networkMode: "standard" });
    assert.equal(adapter.getRefreshDelay(10000), 10000);
  } finally { hub.restore(); }
});

test("push chart reads coalesce and an old unauthorized result cannot expire a newer identity", async () => {
  const hub = installHub();
  const held = deferred<Response>(), begun = deferred<void>();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    await adapter.getSnapshot({ include: {} });
    const canned = globalThis.fetch;
    let reads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("/devices/nas/metrics")) { reads++; begun.resolve(); return held.promise; }
      return canned(input);
    }) as typeof fetch;
    const internal = adapter as unknown as { pullSelectedMetrics: (deviceId: string) => Promise<void> };
    const first = internal.pullSelectedMetrics("nas"), second = internal.pullSelectedMetrics("nas");
    await begun.promise;
    assert.equal(reads, 1);
    await adapter.logout();
    globalThis.fetch = canned;
    await adapter.getSnapshot({ include: {} });
    held.resolve(json({}, 401));
    await Promise.all([first, second]);
    assert.ok(await adapter.live.getLiveConnection("nas"));
  } finally { held.resolve(json({}, 401)); hub.restore(); }
});

test("optional chart failures back off without discarding the live summary and recover on manual refresh", async () => {
  const hub = installHub();
  try {
    const canned = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => String(input).includes("/devices/nas/metrics") ? json({}, 503) : canned(input, init)) as typeof fetch;
    const adapter = adapterAt({ now: 1_000_000 });
    for (let i = 0; i < 3; i++) {
      const snapshot = await adapter.refresh({ selectedDeviceId: "nas", include: { deviceMetrics: true } });
      assert.equal(snapshot.source, "live");
      assert.equal(snapshot.devices[0].deviceId, "nas");
    }
    assert.equal(adapter.getRefreshDelay(10000), 80000);
    globalThis.fetch = canned;
    const recovered = await adapter.refresh({ selectedDeviceId: "nas", include: { deviceMetrics: true } });
    assert.equal(recovered.metrics?.device.deviceId, "nas");
    assert.equal(adapter.getRefreshDelay(10000), 10000);
  } finally { hub.restore(); }
});

test("a changed persisted scope clears an early restored view before the new Hub summary arrives", async () => {
  const hub = installHub();
  try {
    const adapter = adapterAt({ now: 1_000_000 });
    const internal = adapter as unknown as { cache: { activate: () => Promise<boolean> }; snapshot: ConsoleSnapshot };
    internal.snapshot = { ...internal.snapshot, source: "cache", devices: [{ ...device, hostname: "previous account" }] } as ConsoleSnapshot;
    internal.cache.activate = async () => true;
    await adapter.establishSession();
    assert.deepEqual(internal.snapshot.devices, []);
    assert.equal(internal.snapshot.source, "empty");
    assert.equal(internal.snapshot.session.authenticated, true);
  } finally { hub.restore(); }
});
