const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createFixtureProxy } = require("./fixtures/web-hub.cjs");
const { createShapedOrigin } = require("./fixtures/shaped-origin.cjs");
const { fixtureDevices } = require("./fixtures/web-console.cjs");
const { summarize } = require("./loading-acceptance-report.cjs");

const upstream = process.argv[2] ?? "http://127.0.0.1:3000";
const upstreamOrigin = new URL(upstream);
if (upstreamOrigin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(upstreamOrigin.hostname) || upstreamOrigin.username || upstreamOrigin.password || upstreamOrigin.search || upstreamOrigin.hash || upstreamOrigin.pathname !== "/") throw Error("acceptance_requires_local_unauthenticated_http_origin");
const output = path.resolve(process.argv[3] ?? ".codex-artifacts/loading-acceptance");
const sampleCount = 20;
const profile = { latencyMs: 300, downloadBps: 125000, uploadBps: 32000 };
const report = {
  schema: 1, evidence: "CI production Chromium + synthetic HTTP fixture, not domestic WAN or native process startup",
  profile: { ...profile, latencyMeaning: "300ms additional response-header delay; no packet loss, TCP congestion, DNS or TLS emulation", bandwidth: "shared aggregate encoded HTTP body bytes, per direction; includes Service Worker fetches" },
  sampleCount, fixtureDevices: 3, browserVersion: null,
  pwaSeed: "each independent context installs and writes a real cache without shaping; only its controlled restart is measured",
  marks: "React effect commits, not pixels or system cold start; interactive time includes an enabled navigation control and visible fixture summary/cache",
  resourceTiming: "navigation plus completed resources at observation only; not full-page download, server bytes, or private payload export",
  cpu: "unthrottled CI runner; 20 fresh browser contexts, not 20 cold browser processes",
  budgetsAre: "observational CI budgets, reported pass/fail/incomplete without relaxing thresholds; functional assertions gate this test",
  coldWeb: [], cachedPwa: [], checks: [], correctness: "pending"
};
let browser; let fixture; let origin;
const nav = (page, name) => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true });
const marked = (page, name) => page.waitForFunction((name) => performance.getEntriesByName(`guanlan:${name}`).length > 0, name);
function scenario(size = 3) {
  return { mode: "live", mutations: [], reads: [], devices: Array.from({ length: size }, (_, i) => ({ ...fixtureDevices[i % 3], deviceId: size === 3 ? fixtureDevices[i].deviceId : `fixture-${i}`, hostname: `验收设备 ${i + 1}`, sortOrder: i })) };
}
async function open(pwa, state) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: pwa ? "allow" : "block", reducedMotion: "reduce" });
  await context.addCookies([{ name: "dsc-fixture", value: fixture.register(state), url: origin.url }]);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000); page.setDefaultNavigationTimeout(45_000);
  let errors = 0;
  page.on("pageerror", () => errors++);
  return { context, page, noErrors: () => assert.equal(errors, 0, "no page runtime errors") };
}
async function measure(page, source) {
  await marked(page, source === "cache" ? "cache-committed" : "hub-summary-committed");
  await page.locator(".touch-health").waitFor();
  assert.equal(await nav(page, "设备").isEnabled(), true);
  const data = await page.evaluate(() => {
    const mark = (name) => performance.getEntriesByName(`guanlan:${name}`)[0]?.startTime ?? null;
    const resources = performance.getEntriesByType("resource");
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      shellCommittedMs: mark("shell-committed"), cacheCommittedMs: mark("cache-committed"), summaryCommittedMs: mark("hub-summary-committed"), chartsCommittedMs: mark("hub-charts-committed"),
      interactiveMs: performance.now(), fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      resourceRequests: resources.length, encodedBodyBytes: resources.reduce((sum, r) => sum + r.encodedBodySize, navigation?.encodedBodySize ?? 0),
      transferBytes: resources.reduce((sum, r) => sum + r.transferSize, navigation?.transferSize ?? 0)
    };
  });
  // Actually exercise navigation after the recorded observation, not just a
  // hydrated-looking selector. Cache mode remains read-only.
  await nav(page, "设备").tap();
  await page.locator(".touch-directory-pane .touch-device-row__open").first().waitFor();
  return { ok: true, ...data };
}
async function cacheCount(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("guanlan-web-offline-v1", 1);
    request.onerror = () => reject(Error("cache_open_failed"));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) { db.close(); resolve(0); return; }
      const read = db.transaction("snapshots").objectStore("snapshots").get("active");
      read.onsuccess = () => { db.close(); resolve(read.result?.views?.length ?? 0); };
      read.onerror = () => { db.close(); reject(Error("cache_read_failed")); };
    };
  }));
}
async function seed(page) {
  await page.goto(origin.url + "/#overview", { waitUntil: "domcontentloaded" });
  await marked(page, "hub-summary-committed");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
  const deadline = Date.now() + 10_000;
  while (await cacheCount(page) === 0 && Date.now() < deadline) await page.waitForTimeout(25);
  assert.ok(await cacheCount(page) > 0, "seed has a real persisted scoped view");
}
async function coldSample() {
  origin.setEnabled(true);
  const state = scenario();
  state.delayPaths = { "/api/overview/metrics": 30_000, "/api/updates": 30_000 };
  const { context, page, noErrors } = await open(false, state);
  try {
    const optionalStarted = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/overview/metrics");
    await page.goto(origin.url + "/#overview", { waitUntil: "domcontentloaded" });
    await optionalStarted;
    const result = await measure(page, "live");
    assert.ok(state.reads.some((r) => r.path === "/api/overview/metrics"), "the delayed optional path was actually requested");
    assert.equal(result.chartsCommittedMs, null, "30-second optional overview cannot hold summary or first interaction");
    assert.equal(state.reads.filter((r) => r.path === "/api/auth/session").length, 1);
    noErrors(); return result;
  } finally { await context.close(); }
}
async function pwaSample(last) {
  const state = scenario();
  origin.setEnabled(false);
  const { context, page, noErrors } = await open(true, state);
  try {
    await seed(page);
    state.mode = "hang";
    const probes = state.sessionReads;
    origin.setEnabled(true);
    const response = await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(response.fromServiceWorker(), true);
    const result = await measure(page, "cache");
    assert.equal(result.summaryCommittedMs, null, "cached workspace is visible before pending authentication resolves");
    assert.ok(state.sessionReads - probes <= 1, "one pending startup auth probe");
    await page.getByRole("button", { name: "设备目录操作" }).tap();
    assert.equal(await page.getByRole("button", { name: "管理设备顺序" }).isDisabled(), true);
    if (last) {
      await context.setOffline(true);
      const offline = await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal(offline.fromServiceWorker(), true);
      await marked(page, "cache-committed");
      // A no-worker control cannot load a cold document with no network.
      const control = await browser.newContext({ serviceWorkers: "block", offline: true });
      try { await assert.rejects((await control.newPage()).goto(origin.url, { timeout: 5000 })); }
      finally { await control.close(); }
      state.mode = "live";
      await context.setOffline(false);
      await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
      await marked(page, "hub-summary-committed");
      state.sessionDelay = { milliseconds: 5000, status: 401 };
      await page.reload({ waitUntil: "domcontentloaded" });
      await marked(page, "cache-committed");
      await page.locator("#access-key").waitFor();
      assert.equal(await cacheCount(page), 0);
      assert.equal(await page.locator(".touch-workspace").count(), 0);
      report.checks.push("browser offline Worker restart + no-worker negative control; online/manual recovery; delayed 401 evicts cached workspace and IndexedDB");
    }
    noErrors(); return result;
  } finally { await context.close(); origin.setEnabled(true); }
}
async function scaleCheck(size) {
  origin.setEnabled(true);
  const state = scenario(size);
  const { context, page, noErrors } = await open(false, state);
  try {
    await page.goto(origin.url + "/#overview", { waitUntil: "domcontentloaded" });
    await measure(page, "live");
    assert.equal(await page.locator(".touch-directory-pane .touch-device-row__open").count(), size);
    noErrors(); report.checks.push(`${size}-device summary/navigation fixture under shaped origin (functional only; not percentile or database evidence)`);
  } finally { await context.close(); }
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  fixture = await createFixtureProxy(upstream);
  origin = await createShapedOrigin(fixture.url, profile);
  browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  report.browserVersion = browser.version();
  for (let i = 0; i < sampleCount; i++) {
    try { report.coldWeb.push(await coldSample()); }
    catch (error) { report.coldWeb.push({ ok: false, error: error.name === "TimeoutError" ? "timeout" : "assertion_or_runtime_failure" }); throw error; }
  }
  report.checks.push("20 independent cold Web contexts: summary and usable navigation before 30s optional overview; one session probe each");
  for (let i = 0; i < sampleCount; i++) {
    try { report.cachedPwa.push(await pwaSample(i === sampleCount - 1)); }
    catch (error) { report.cachedPwa.push({ ok: false, error: error.name === "TimeoutError" ? "timeout" : "assertion_or_runtime_failure" }); throw error; }
  }
  report.checks.push("20 independent seeded PWA contexts: Worker-served document, real cache commit before hung session, read-only navigation");
  await scaleCheck(30); await scaleCheck(100);
  report.correctness = "pass";
})().catch((error) => {
  report.correctness = "fail";
  // Do not export raw page content, cookies, URL queries, or error stacks.
  console.error("loading acceptance failed:", error.name, error instanceof assert.AssertionError ? error.message : "see sample status");
  process.exitCode = 1;
}).finally(async () => {
  report.summary = {
    coldWeb: summarize(report.coldWeb, ["shellCommittedMs", "summaryCommittedMs", "interactiveMs", "fcpMs", "encodedBodyBytes", "transferBytes", "resourceRequests"]),
    cachedPwa: summarize(report.cachedPwa, ["cacheCommittedMs", "interactiveMs", "fcpMs", "encodedBodyBytes", "transferBytes", "resourceRequests"])
  };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "loading-acceptance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  await browser?.close(); await origin?.close(); await fixture?.close();
});
