import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
let encryptedStorage = false;
mock.module(desktopRequire.resolve("electron"), { namedExports: {
  safeStorage: { isEncryptionAvailable: () => encryptedStorage, encryptString: (value) => Buffer.from(value), decryptString: (value) => value.toString() },
  app: { getPath: () => tmpdir(), getVersion: () => "3.0.160" }, shell: {}
} });
const { HubClient } = await import("../apps/desktop/src/main/hub-client.ts");
const { DesktopController } = await import("../apps/desktop/src/main/controller.ts");
const { DesktopCacheStore } = await import("../apps/desktop/src/main/cache-store.ts");
const { withReadDeadline } = await import("../apps/desktop/src/main/read-deadline.ts");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const device = { deviceId: "a", hostname: "nas" };
const metrics = { device, window: "5m", series: {}, latest: {} };
function fixture() {
  const controller = new DesktopController();
  const events = [], calls = [];
  controller.hub.accessKey = "fixture";
  controller.hub.setServerUrl("https://hub.example");
  controller.cache = { read: async () => null, write: async () => {}, clear: async () => {}, flush: async () => {} };
  controller.agent = { start: () => new Promise(() => {}) };
  controller.hub.listDevices = async () => { calls.push("summary"); return [device]; };
  controller.hub.getMetrics = async () => { calls.push("metrics"); return metrics; };
  controller.hub.getOverviewMetrics = async () => { calls.push("overview"); return { window: "5m", instances: [] }; };
  controller.hub.getTrafficCalendar = async () => { calls.push("calendar"); return { mode: "day", anchor: "today" }; };
  controller.hub.getUpdateInfo = async () => { calls.push("update"); return {}; };
  controller.subscribe((value) => events.push(value));
  return { controller, events, calls };
}

test("Agent start, cache persistence and updates never gate remote summary or completion", async () => {
  const { controller, events, calls } = fixture();
  const chart = deferred();
  controller.hub.getMetrics = () => chart.promise;
  controller.hub.getUpdateInfo = () => new Promise(() => {});
  controller.cache.write = () => new Promise(() => {});
  const pending = controller.refresh({ selectedDeviceId: "a", include: { deviceMetrics: true } });
  await settle();
  assert.equal(events[0].source, "live");
  assert.equal(events[0].devices[0].deviceId, "a");
  assert.equal(events[0].metrics, null);
  assert.equal(calls.includes("overview"), false); assert.equal(calls.includes("calendar"), false);
  chart.resolve(metrics);
  assert.equal((await pending).metrics, metrics);
  assert.equal(events.at(-1).metrics, metrics);
});

test("cached first paint is read-only and starts one background summary refresh", async () => {
  const { controller } = fixture();
  const summary = deferred();
  controller.hub.listDevices = () => summary.promise;
  controller.cache.read = async () => ({ ...controller.emptySnapshot(), source: "live", devices: [device] });
  const cached = await controller.getSnapshot({ include: {} });
  assert.equal(cached.source, "cache"); assert.equal(cached.session.authenticated, false);
  summary.resolve([device]); await settle();
  assert.equal(controller.currentSnapshot.source, "live");
});

test("cached drilldown never labels another device or time window's graph as the requested one", () => {
  const { controller } = fixture();
  const cached = { ...controller.emptySnapshot(), selectedDeviceId: "a", metrics, trafficCalendar: { mode: "day", anchor: "today" } };
  const other = controller.asCachedSnapshot(cached, undefined, { selectedDeviceId: "b" });
  assert.equal(other.selectedDeviceId, "b"); assert.equal(other.metrics, null); assert.equal(other.trafficCalendar, null);
  assert.equal(controller.asCachedSnapshot(cached, undefined, { selectedDeviceId: "a", metricWindow: "1h" }).metrics, null);
});

test("saver limits optional concurrency to one; default legacy reads are bounded at two", async () => {
  for (const [networkMode, expected] of [["saver", 1], ["standard", 2]]) {
    const { controller } = fixture();
    const gate = deferred(); let active = 0, maximum = 0;
    const read = async () => { maximum = Math.max(maximum, ++active); await gate.promise; active--; return null; };
    controller.hub.getMetrics = read; controller.hub.getOverviewMetrics = read; controller.readTrafficCalendar = read;
    const pending = controller.refresh({ networkMode }); await settle();
    assert.equal(maximum, expected);
    gate.resolve(); await pending; assert.equal(maximum, expected);
  }
});

test("switching selection cancels an ignored transport without accepting its late data", async () => {
  const { controller } = fixture();
  const original = globalThis.fetch;
  controller.hub.sessionCookie = "dsc_session=fixture";
  const late = deferred();
  controller.hub.getMetrics = HubClient.prototype.getMetrics.bind(controller.hub);
  globalThis.fetch = async (url) => String(url).includes("/a/") ? late.promise : Response.json({ ...metrics, device: { deviceId: "b" } });
  controller.hub.listDevices = async () => [device, { deviceId: "b" }];
  try {
    const first = controller.refresh({ selectedDeviceId: "a", include: { deviceMetrics: true } }); await settle();
    const next = controller.refresh({ selectedDeviceId: "b", include: { deviceMetrics: true } });
    assert.equal((await next).metrics.device.deviceId, "b");
    await first;
    late.resolve(Response.json(metrics)); await settle();
    assert.equal(controller.currentSnapshot.metrics.device.deviceId, "b");
  } finally { controller.cancelSnapshot(); late.resolve(Response.json(metrics)); globalThis.fetch = original; }
});

test("authorization denial evicts cache, cancels late optional results, and cannot resurrect telemetry", async () => {
  const { controller } = fixture(); let cleared = 0;
  controller.cache.clear = async () => { cleared++; };
  controller.cache.read = async () => ({ ...controller.emptySnapshot(), devices: [device] });
  controller.hub.listDevices = async () => { throw new Error("hub_403:forbidden"); };
  assert.deepEqual((await controller.refresh()).devices, []); assert.equal(cleared, 1);
});

test("automatic retries back off, while manual refresh and successful recovery are immediate", async () => {
  const { controller, calls } = fixture();
  controller.hub.getMetrics = async () => { throw new Error("offline"); };
  await controller.refresh({ include: { deviceMetrics: true }, networkMode: "saver" });
  assert.ok(controller.nextAutoReadAt - Date.now() > 59_000);
  const before = calls.length;
  await controller.refresh({ background: true }); assert.equal(calls.length, before);
  controller.hub.getMetrics = async () => metrics;
  await controller.refresh({ background: false }); assert.ok(calls.length > before);
  assert.equal(controller.failures, 0);
});

test("deadline covers hung body and ignored abort, caller cancellation is immediate", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const hung = withReadDeadline(async () => new Promise(() => {}), [], 100);
    const rejected = assert.rejects(hung, /timeout/);
    t.mock.timers.tick(100); await rejected;
    const caller = new AbortController();
    const pending = withReadDeadline(async () => new Promise(() => {}), [caller.signal]);
    const cancelled = assert.rejects(pending, /switch/);
    caller.abort(new Error("switch")); await cancelled;
  } finally { t.mock.timers.reset(); }
});

test("Hub request deadlines remain effective after headers while its body never completes", async (t) => {
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => ({ text: () => new Promise(() => {}) });
  try {
    const hub = new HubClient("/unused"); hub.setServerUrl("https://hub.example"); hub.accessKey = "fixture"; hub.sessionCookie = "dsc_session=fixture";
    const pending = hub.getMetrics("a", "5m");
    const expired = assert.rejects(pending, /hub_request_timeout/);
    await settle(); t.mock.timers.tick(15_000); await expired;
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});

test("standard reads remain full precision while saver sends the optional point budget", async () => {
  for (const [networkMode, expected] of [["standard", undefined], ["saver", 120]]) {
    const { controller } = fixture(); let received;
    controller.hub.getMetrics = async (_device, _window, _signal, budget) => { received = budget; return metrics; };
    await controller.refresh({ networkMode, include: { deviceMetrics: true } });
    assert.equal(received, expected);
  }
});

test("cancelled consumers do not wait for or cancel a shared authentication needed by a newer view", async () => {
  const original = globalThis.fetch; const login = deferred(); let logins = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/auth/login")) { logins++; return login.promise; }
    return Response.json(metrics);
  };
  try {
    const hub = new HubClient("/unused"); hub.setServerUrl("https://hub.example"); hub.accessKey = "fixture";
    const cancel = new AbortController();
    const first = hub.getMetrics("a", "5m", cancel.signal);
    const second = hub.getMetrics("b", "5m");
    const rejected = assert.rejects(first, /switch/);
    await settle(); cancel.abort(new Error("switch")); await rejected;
    assert.equal(logins, 1);
    login.resolve(Response.json({ ok: true }, { headers: { "set-cookie": "dsc_session=new; Path=/" } }));
    assert.ok(await second);
  } finally { globalThis.fetch = original; }
});

test("private GETs may reauthenticate once; management writes are never replayed", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method ?? "GET" });
    if (String(url).includes("/auth/login")) return Response.json({ ok: true }, { headers: { "set-cookie": "dsc_session=new; Path=/" } });
    return Response.json({}, { status: 401 });
  };
  try {
    const hub = new HubClient("/unused"); hub.setServerUrl("https://hub.example"); hub.accessKey = "fixture"; hub.sessionCookie = "dsc_session=old";
    await assert.rejects(hub.deleteDevice("a"), /hub_401/);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, "DELETE");
    await assert.rejects(hub.getMetrics("a", "5m"), /hub_401/);
    assert.equal(calls.filter((call) => call.url.includes("/auth/login")).length, 1);
    assert.equal(calls.filter((call) => call.url.includes("/metrics")).length, 2);
  } finally { globalThis.fetch = original; }
});

test("persisted cache requires matching Hub/identity, expires after a day, and clear wins over an old flush", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dsc-scoped-cache-"));
  try {
    const cache = new DesktopCacheStore(dir);
    const snapshot = { ...new DesktopController().emptySnapshot(), generatedAt: new Date().toISOString(), source: "live", session: { authenticated: true, secret: "must-not-persist" }, devices: [device] };
    await cache.write(snapshot, "hub|identity");
    assert.equal((await cache.read("hub|identity")).session.authenticated, false);
    assert.equal(await new DesktopCacheStore(dir).read("other|identity"), null);
    assert.equal(await new DesktopCacheStore(dir).read(), null);
    assert.doesNotMatch(await readFile(path.join(dir, "desktop-cache.json"), "utf8"), /must-not-persist/);
    const old = { version: 2, scope: "hub|identity", savedAt: "2000-01-01T00:00:00Z", snapshot };
    await writeFile(path.join(dir, "desktop-cache.json"), JSON.stringify(old));
    assert.equal(await new DesktopCacheStore(dir).read("hub|identity"), null);
    const flush = cache.flush(); const cleared = cache.clear(); await Promise.all([flush, cleared]);
    assert.equal(await new DesktopCacheStore(dir).read("hub|identity"), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("random cache identity survives encrypted credential restore, but changes on a new account or Hub", async () => {
  const original = globalThis.fetch;
  const dir = await mkdtemp(path.join(tmpdir(), "dsc-cache-identity-"));
  globalThis.fetch = async () => Response.json({ ok: true }, { headers: { "set-cookie": "dsc_session=fixture; Path=/" } });
  encryptedStorage = true;
  try {
    const file = path.join(dir, "credentials.json");
    const hub = new HubClient(file); hub.setServerUrl("https://hub.example");
    await hub.login("fixture-account-a");
    const scope = hub.cacheScope;
    assert.ok(scope && !scope.includes("fixture-account-a"));
    const restored = new HubClient(file); await restored.initialize(); restored.setServerUrl("https://hub.example");
    assert.equal(restored.cacheScope, scope);
    await hub.login("fixture-account-a"); assert.equal(hub.cacheScope, scope, "session renewal keeps the same identity");
    await hub.login("fixture-account-b"); assert.notEqual(hub.cacheScope, scope);
    const next = hub.cacheScope;
    hub.setServerUrl("https://other.example"); assert.notEqual(hub.cacheScope, next);
    await hub.logout(); assert.equal(hub.cacheScope, null);
  } finally { encryptedStorage = false; globalThis.fetch = original; await rm(dir, { recursive: true, force: true }); }
});

test("late private responses after identity change cannot refill memory caches or send an old management write", async () => {
  const original = globalThis.fetch;
  const gate = deferred(); const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return gate.promise; };
  try {
    const hub = new HubClient("/unused"); hub.setServerUrl("https://first.example"); hub.accessKey = "fixture"; hub.sessionCookie = "dsc_session=old";
    const read = hub.getOverviewMetrics("5m"); await settle();
    const denied = assert.rejects(read, /hub_session_changed/);
    hub.setServerUrl("https://second.example");
    await denied; gate.resolve(Response.json({ window: "5m", instances: [] })); await settle();
    assert.equal(hub.overviewCache, null);
    const auth = deferred(); hub.ensureSession = () => auth.promise;
    const mutation = hub.deleteDevice("a");
    hub.setServerUrl("https://third.example"); auth.resolve();
    await assert.rejects(mutation, /hub_session_changed/);
    assert.ok(calls.every((url) => url.startsWith("https://first.example")));
  } finally { gate.resolve(Response.json({})); globalThis.fetch = original; }
});

test("late chart results cannot refill the view after a sibling's authorization denial", async () => {
  const { controller, events } = fixture();
  const late = deferred();
  controller.hub.getMetrics = () => late.promise;
  controller.hub.getOverviewMetrics = async () => { throw new Error("hub_401:expired"); };
  await controller.refresh({ include: { deviceMetrics: true, overviewMetrics: true } });
  assert.deepEqual(events.at(-1).devices, []);
  late.resolve(metrics); await settle();
  assert.deepEqual(events.at(-1).devices, []); assert.equal(events.at(-1).metrics, null);
});

test("denied management writes clear the private view too, without replay", async () => {
  const { controller, events } = fixture(); const original = globalThis.fetch; let writes = 0, clears = 0;
  controller.hub.sessionCookie = "dsc_session=fixture";
  controller.cache.clear = async () => { clears++; };
  controller.currentSnapshot = { ...controller.emptySnapshot(), devices: [device] };
  globalThis.fetch = async () => { writes++; return Response.json({}, { status: 403 }); };
  try {
    await assert.rejects(controller.deleteInstance("a"), /hub_403/);
    assert.equal(writes, 1); assert.equal(clears, 1);
    assert.deepEqual(events.at(-1).devices, []);
  } finally { globalThis.fetch = original; }
});

test("a successful mutation rereads even the same selection rather than joining pre-write data", async () => {
  const { controller } = fixture(); const original = globalThis.fetch; const stale = deferred(); let reads = 0;
  controller.hub.sessionCookie = "dsc_session=fixture";
  controller.hub.getMetrics = HubClient.prototype.getMetrics.bind(controller.hub);
  controller.hub.reorderDevices = async () => {};
  globalThis.fetch = async () => ++reads === 1 ? stale.promise : Response.json(metrics);
  try {
    const pending = controller.refresh({ selectedDeviceId: "a", include: { deviceMetrics: true } }); await settle();
    const result = await controller.reorderInstances(["a"]);
    await pending;
    assert.equal(reads, 2); assert.equal(result.metrics.device.deviceId, "a");
  } finally { stale.resolve(Response.json(metrics)); controller.cancelSnapshot(); globalThis.fetch = original; }
});
