const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { fixtureDevices } = require("./fixtures/web-console.cjs");
const { createFixtureProxy } = require("./fixtures/web-hub.cjs");
const upstreamUrl = process.argv[2] ?? "http://127.0.0.1:3000";
let baseUrl;
let fixtureProxy;
const output = path.resolve(process.argv[3] ?? ".codex-artifacts/mobile-touch");
const requirePwa = process.argv.includes("--pwa");
const engineName = process.argv.includes("--webkit") ? "webkit" : "chromium";
fs.mkdirSync(output, { recursive: true });
const phoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const tabletUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const report = { engine: engineName, pwa: requirePwa, checks: [], screenshots: [] };
let browser;
const diagnostics = new WeakMap();

async function fixture(context, scenario) {
  await context.addCookies([{ name: "dsc-fixture", value: fixtureProxy.register(scenario), url: baseUrl }]);
}
async function setup({ tablet = false, storageDenied = false, empty = false, delayedSession = false } = {}) {
  const context = await browser.newContext({ viewport: { width: tablet ? 1024 : 390, height: tablet ? 768 : 844 }, screen: { width: tablet ? 1024 : 390, height: tablet ? 768 : 844 }, hasTouch: true, isMobile: true, reducedMotion: "no-preference", userAgent: tablet ? tabletUA : phoneUA, serviceWorkers: requirePwa ? "allow" : "block" });
  await context.addInitScript(() => {
    window.__dscNavigationMotion = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(frames, options) {
      if (this.parentElement?.classList.contains("touch-main-pane")) window.__dscNavigationMotion.push(frames[0]?.transform);
      return animate.call(this, frames, options);
    };
  });
  if (storageDenied) await context.addInitScript(() => Object.defineProperty(window, "indexedDB", { get() { throw new DOMException("Storage denied", "SecurityError"); } }));
  const scenario = { mode: empty ? "empty" : "live", devices: structuredClone(fixtureDevices), mutations: [] };
  if (delayedSession) scenario.sessionDelay = { milliseconds: 1500, status: 401 };
  await fixture(context, scenario);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  diagnostics.set(page, { errors, requests });
  const record = (request, result) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) requests.push({ pathname, result, at: Date.now() });
  };
  page.on("request", (request) => record(request, "started"));
  page.on("response", (response) => record(response.request(), response.status()));
  page.on("requestfailed", (request) => record(request, request.failure()?.errorText ?? "failed"));
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  // Development compilation on the shared disk can delay document loads.
  page.setDefaultNavigationTimeout(120_000);
  await page.goto(baseUrl + "#overview", { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (delayedSession) {
    const started = Date.now();
    while (!scenario.sessionDelayStarted && Date.now() - started < 20_000) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(scenario.sessionDelayStarted, true);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
  await page.locator(".touch-health").waitFor();
  if (delayedSession) {
    await page.waitForTimeout(1700);
    assert.equal(await page.locator(".touch-health").count(), 1, "a stale bootstrap response must not replace an authenticated workspace");
    assert.equal(await page.locator("#access-key").count(), 0);
  }
  if (requirePwa) {
    // Start every production flow after the shell has finished installation;
    // reloading during CacheStorage writes can stall WebKit automation.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
  }
  return { page, context, scenario, errors };
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(output, name + ".png"), animations: "disabled" });
  report.screenshots.push(name + ".png");
}
function nav(page, name) { return page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }); }
async function dimensions(page) {
  // Measure the settled layout. Navigation intentionally moves its content;
  // an in-flight transform changes scrollWidth without changing text fit.
  await page.evaluate(async () => {
    const animations = [...document.querySelectorAll(".touch-main-pane, .touch-directory-pane")].flatMap((pane) => pane.getAnimations({ subtree: true }));
    await Promise.all(animations.filter((animation) => Number.isFinite(animation.effect?.getTiming().iterations)).map((animation) => animation.finished.catch(() => undefined)));
  });
  const overflow = await page.evaluate(() => [...document.querySelectorAll(".touch-main-pane, .touch-directory-pane")].filter((el) => !el.hidden).map((el) => ({ name: el.className, client: el.clientWidth, scroll: el.scrollWidth })));
  assert.ok(overflow.every((item) => item.scroll <= item.client + 2), JSON.stringify(overflow));
  const targets = await page.evaluate(() => [...document.querySelectorAll(".touch-workspace button, .touch-workspace input, .touch-workspace select, .touch-sheet[open] button")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.closest("[hidden]") && r.bottom > 0 && r.top < innerHeight;
  }).map((el) => ({ label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 24), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })).filter((r) => r.width < 47.5 || r.height < 47.5));
  assert.deepEqual(targets, [], "touch controls must have a 48px target");
}
async function cacheViewCount(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("guanlan-web-offline-v1", 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) { db.close(); resolve(0); return; }
      const read = db.transaction("snapshots").objectStore("snapshots").get("active");
      read.onsuccess = () => { db.close(); resolve(read.result?.views?.length ?? 0); };
    };
  }));
}
async function selectValue(page, label, value) {
  const control = page.getByRole("combobox", { name: label, exact: true });
  const text = await control.locator("..").locator(`select option[value="${value}"]`).textContent();
  await control.tap();
  await page.getByRole("listbox", { name: label, exact: true }).getByRole("option", { name: text, exact: true }).tap();
  await page.waitForFunction(({ label, value }) => [...document.querySelectorAll('.m3e-select')].some((el) => el.querySelector('label')?.textContent === label && el.querySelector('select')?.value === value), { label, value });
}
async function selectedValue(page, label) {
  return page.getByRole("combobox", { name: label, exact: true }).locator("..").locator("select").inputValue();
}
async function phoneFlow() {
  const { page, context, scenario, errors } = await setup();
  assert.equal(await page.getByText("1 台设备需要关注", { exact: true }).count(), 1);
  assert.equal(await page.locator(".touch-overview .touch-section").first().locator(".touch-device-row__open").getAttribute("data-device-id"), "offline-01");
  assert.equal(await page.evaluate(() => document.querySelector('meta[name="viewport"]').content.includes("user-scalable=no")), false);
  for (const width of [320, 360, 390, 430, 736]) {
    await page.setViewportSize({ width, height: width === 736 ? 390 : 844 });
    await dimensions(page);
    assert.equal(await page.locator(".touch-workspace").getAttribute("data-presentation"), "phone");
    await shot(page, `phone-${width}-overview`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, "设备").tap();
  const search = page.getByRole("textbox", { name: "搜索设备" });
  await search.fill("归档");
  await dimensions(page);
  assert.equal(await page.locator(".touch-directory-pane .touch-device-row__open").count(), 1);
  await page.getByRole("button", { name: "筛选与排序", exact: true }).tap();
  await page.getByRole("dialog", { name: "筛选与排序" }).waitFor();
  await dimensions(page);
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await search.inputValue(), "归档");
  await page.locator(".touch-directory-pane [data-device-id=nas-01]").tap();
  assert.equal(await page.evaluate(() => window.__dscNavigationMotion.at(-1)), "translateX(16px)", "closing a sheet must not reverse the next forward navigation");
  await page.getByRole("tab", { name: "趋势", exact: true }).tap();
  await selectValue(page, "趋势分类", "network");
  await page.getByRole("button", { name: "返回上一页" }).tap();
  await page.locator(".touch-directory-pane").waitFor({ state: "visible" });
  assert.equal(await search.inputValue(), "归档");
  await page.locator(".touch-directory-pane [data-device-id=nas-01]").tap();
  assert.equal(await page.getByRole("tab", { name: "趋势", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await selectedValue(page, "趋势分类"), "network");
  await page.getByRole("tab", { name: "硬件", exact: true }).tap();
  await dimensions(page);
  const headingBox = await page.locator(".touch-main-pane .dashboard-section__header").boundingBox();
  const cardBox = await page.locator(".touch-main-pane .chart-tile").first().boundingBox();
  assert.ok(cardBox.y - (headingBox.y + headingBox.height) < 40, "hardware content must follow its heading without an empty viewport-sized gap");
  await shot(page, "phone-hardware");
  await page.getByRole("button", { name: "返回上一页" }).tap();
  await page.getByRole("button", { name: "归档 NAS的更多操作", exact: true }).tap();
  await page.getByRole("button", { name: "设为常用设备", exact: true }).tap();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await nav(page, "总览").tap();
  assert.equal(await page.getByRole("heading", { name: "常用设备", exact: true }).count(), 1);
  await nav(page, "设置").tap();
  await page.locator(".touch-category-list").getByRole("button").filter({ hasText: "通用" }).tap();
  await page.getByRole("button", { name: "查看", exact: true }).tap();
  await page.getByRole("dialog", { name: "安装与离线使用", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.getByRole("heading", { name: "启动与刷新", exact: true }).count(), 1);
  await page.getByRole("button", { name: "返回设置分类" }).tap();
  await page.locator(".touch-settings__directory").waitFor({ state: "visible" });
  await dimensions(page);
  await page.locator(".touch-category-list").getByRole("button").filter({ hasText: "外观" }).tap();
  await page.getByRole("tab", { name: "深色", exact: true }).tap();
  await shot(page, "phone-dark-settings");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await nav(page, "设备").tap();
  await page.getByRole("button", { name: "设备目录操作" }).tap();
  assert.equal(await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).animationName), "none");
  await page.getByRole("button", { name: "管理设备顺序" }).tap();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator(".touch-directory-pane .touch-device-row__open").count(), scenario.devices.length);
  await page.getByRole("button", { name: "下移工作站 · 上海" }).tap();
  assert.equal(scenario.mutations.length, 0);
  await page.getByRole("button", { name: "保存顺序", exact: true }).tap();
  await page.getByRole("button", { name: "保存顺序", exact: true }).waitFor({ state: "detached" });
  assert.equal(scenario.mutations.filter((item) => item.path === "/api/devices/reorder").length, 1);
  assert.ok(await cacheViewCount(page) > 0);
  const previousViews = await cacheViewCount(page);
  scenario.sessionDelay = { milliseconds: 750, status: 401 };
  await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
  const delayedStarted = Date.now();
  while (!scenario.sessionDelayStarted && Date.now() - delayedStarted < 5000) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(scenario.sessionDelayStarted, true);
  // Foreground recovery starts a newer authenticated read while the old
  // session response is still pending. Its 401 must not evict cached views.
  const sessionReads = scenario.sessionReads;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(950);
  assert.ok(scenario.sessionReads > sessionReads, "foreground recovery starts a newer session read");
  assert.ok(await cacheViewCount(page) >= previousViews, "a stale 401 must retain the previously cached device views");
  assert.equal(await page.getByText("浏览器会话已失效", { exact: true }).count(), 0, "a stale 401 cannot expire a newer session read");
  assert.ok(await cacheViewCount(page) > 0);
  scenario.mode = "network";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/离线缓存 ·/).waitFor();
  await nav(page, "总览").tap();
  assert.equal(await page.getByText("当前状态待确认", { exact: true }).count(), 1);
  assert.equal(await page.getByText("设备都在线", { exact: true }).count(), 0);
  await nav(page, "设备").tap();
  await page.getByRole("button", { name: "设备目录操作" }).tap();
  assert.equal(await page.getByRole("button", { name: "管理设备顺序" }).isDisabled(), true);
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await shot(page, "phone-offline-cache");
  await nav(page, "设置").tap();
  await page.locator(".touch-category-list").getByRole("button").filter({ hasText: "连接" }).tap();
  await page.getByRole("heading", { name: "正在查看离线缓存", exact: true }).waitFor();
  assert.equal(await page.getByText("会话需要重新认证", { exact: true }).count(), 0);
  scenario.mode = "live";
  await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
  await page.getByText(/离线缓存 ·/).waitFor({ state: "detached" });
  scenario.mode = "unauthorized";
  await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
  await page.getByText("浏览器会话已失效", { exact: true }).waitFor();
  assert.equal(await cacheViewCount(page), 0);
  scenario.mode = "network";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "暂时无法连接", exact: true }).waitFor();
  assert.equal(await page.locator("#access-key").count(), 0, "network failure must not masquerade as login failure");
  assert.deepEqual(errors, []);
  report.checks.push("phone navigation, search, back, panels, pins, management, cache, recovery, 401 eviction, reduced motion");
  await context.close();
}
async function tabletFlow() {
  const { page, context, scenario, errors } = await setup({ tablet: true });
  await nav(page, "设备").tap();
  await page.locator(".touch-directory-pane [data-device-id=workstation-01]").tap();
  await page.getByRole("tab", { name: "趋势", exact: true }).tap();
  await selectValue(page, "趋势分类", "compute");
  for (const [width, height] of [[768, 1024], [834, 1112], [1024, 768], [1366, 1024], [430, 1024]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction((split) => document.querySelector(".touch-workspace")?.classList.contains("is-split") === split, width >= 840);
    assert.equal(await page.locator(".touch-workspace").getAttribute("data-presentation"), "tablet", JSON.stringify(await page.evaluate(() => ({ width: innerWidth, screen: [screen.width, screen.height], touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches, ua: navigator.userAgent }))));
    assert.equal(await page.locator(".touch-directory-pane").isVisible(), width >= 840);
    assert.equal(await selectedValue(page, "趋势分类"), "compute");
    await dimensions(page);
    await shot(page, `tablet-${width}-detail`);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator(".touch-directory-pane [data-device-id=nas-01]").tap();
  await page.waitForFunction(() => document.querySelector(".touch-device-heading h1")?.textContent === "归档 NAS");
  await page.locator(".touch-directory-pane [data-device-id=workstation-01]").tap();
  assert.equal(await selectedValue(page, "趋势分类"), "compute");
  await page.evaluate(() => { document.documentElement.style.setProperty("--md-sys-typescale-body-m-size", "21px"); document.documentElement.style.setProperty("--md-sys-typescale-title-m-size", "24px"); });
  await dimensions(page);
  await shot(page, "tablet-large-text");
  scenario.deniedPath = "/api/overview/metrics";
  await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
  await page.getByText("浏览器会话已失效", { exact: true }).waitFor();
  assert.equal(await cacheViewCount(page), 0, "403 from an auxiliary read also evicts the authenticated cache");
  assert.deepEqual(errors, []);
  report.checks.push("tablet columns, selection, rotation, split window, per-device view state and enlarged text");
  await context.close();
}
async function rapidDeviceSelection() {
  for (const tablet of [false, true]) {
    const { page, context, scenario, errors } = await setup({ tablet });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(250);
    scenario.delayId = "nas-01";
    await nav(page, "设备").tap();
    const reads = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/^\/api\/devices\/[^/]+\/metrics$/.test(pathname)) reads.push(pathname);
    });
    const nasRead = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/devices/nas-01/metrics");
    await page.locator(".touch-directory-pane [data-device-id=nas-01]").tap();
    await nasRead;
    if (!tablet) await page.getByRole("button", { name: "返回上一页" }).tap();
    const selectedRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/devices/workstation-01/metrics");
    await page.locator(".touch-directory-pane [data-device-id=workstation-01]").tap();
    await selectedRead;
    assert.equal(reads.at(-1), "/api/devices/workstation-01/metrics", "queued requests must retain the last selected device");
    assert.equal(await page.locator(".touch-device-heading h1").innerText(), "工作站 · 上海");
    assert.deepEqual(errors, []);
    if (!tablet) await shot(page, "phone-rapid-device-switch");
    await context.close();
  }
  report.checks.push("rapid phone and tablet selection during a delayed read fetches the last selected device");
}
async function coldOfflineAndStorage() {
  const stalled = await setup();
  await stalled.page.waitForTimeout(250);
  const readsBeforeStall = stalled.scenario.sessionReads;
  stalled.scenario.mode = "hang";
  await stalled.page.reload({ waitUntil: "domcontentloaded" });
  // One bounded authentication attempt can fall back to cached telemetry;
  // mounting the workspace must not wait through a second 12-second probe.
  await stalled.page.getByText(/离线缓存 ·/).waitFor({ timeout: 18_000 });
  await nav(stalled.page, "设备").tap();
  assert.equal(stalled.scenario.sessionReads, readsBeforeStall + 1);
  assert.equal(await stalled.page.locator(".touch-directory-pane .touch-device-row__open").count(), stalled.scenario.devices.length);
  assert.deepEqual(stalled.errors, []);
  await stalled.context.close();
  report.checks.push("stalled authentication falls back once and cached navigation does not repeat the network probe");
  const recovered = await setup({ delayedSession: true });
  assert.deepEqual(recovered.errors, []);
  await recovered.context.close();
  report.checks.push("overlapping bootstrap and foreground session reads ignore stale authentication failures");
  for (const storageDenied of [false, true]) {
    const { page, context, scenario, errors } = await setup({ storageDenied });
    if (storageDenied) {
      scenario.mode = "network";
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "暂时无法连接", exact: true }).waitFor();
    } else {
      scenario.mode = "network";
      if (requirePwa) {
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60_000 });
        const keys = await page.evaluate(async () => { const cache = await caches.open((await caches.keys()).find((key) => key.startsWith("guanlan-shell-"))); return (await cache.keys()).map((request) => new URL(request.url).pathname); });
        assert.ok(!keys.some((key) => key.startsWith("/api/") || key.startsWith("/socket.io")));
        // WebKit's automation offline flag rejects even Worker-only
        // navigation (microsoft/playwright#42775). Stop this origin instead;
        // Chromium still exercises actual browser-level offline emulation.
        if (engineName === "webkit") await fixtureProxy.pause();
        else await context.setOffline(true);
        const noWorker = await browser.newContext({ serviceWorkers: "block", offline: engineName !== "webkit" });
        try { await assert.rejects((await noWorker.newPage()).goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 10_000 })); }
        finally { await noWorker.close(); }
        const cachedDocument = await page.reload({ waitUntil: "domcontentloaded" });
        assert.equal(cachedDocument.status(), 200);
        assert.equal(cachedDocument.fromServiceWorker(), true, "the Worker must serve the restarted document");
        await page.getByText(/离线缓存 ·/).waitFor();
        await nav(page, "设备").tap();
        await page.locator(".touch-directory-pane [data-device-id=workstation-01]").tap();
        await page.getByRole("tab", { name: "硬件", exact: true }).tap();
        await dimensions(page);
        await shot(page, "pwa-cold-offline-detail");
        if (engineName === "webkit") await fixtureProxy.resume();
        else await context.setOffline(false);
        scenario.mode = "live";
        await page.getByRole("button", { name: "刷新状态", exact: true }).tap();
        await page.getByText(/离线缓存 ·/).waitFor({ state: "detached" });
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context, errors } = await setup({ empty: true });
  assert.equal(await page.getByText("等待第一台设备", { exact: true }).count(), 1);
  assert.equal(await page.getByText("设备都在线", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  report.checks.push(requirePwa ? `${engineName === "webkit" ? "origin outage" : "browser offline"}: Worker-served restart, no-worker negative control, read-only drilldown, API exclusion, storage denial and empty fleet` : "storage denial and empty fleet; production worker tested in CI");
}
(async () => {
  fixtureProxy = await createFixtureProxy(upstreamUrl);
  baseUrl = fixtureProxy.url;
  browser = await (engineName === "webkit" ? webkit : chromium).launch({ headless: true, ...(process.env.DSC_PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.DSC_PLAYWRIGHT_EXECUTABLE } : {}), args: engineName === "chromium" ? ["--disable-dev-shm-usage"] : [] });
  await phoneFlow();
  await tabletFlow();
  await rapidDeviceSelection();
  await coldOfflineAndStorage();
  fs.writeFileSync(path.join(output, "mobile-touch-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(async (error) => {
  console.error(error);
  fs.writeFileSync(path.join(output, "failure.txt"), error.stack ?? String(error));
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
    fs.writeFileSync(path.join(output, "failure-state.txt"), await page.locator("body").innerText().catch(() => "unavailable"));
    const runtime = await page.evaluate(() => ({ ready: document.readyState, visibility: document.visibilityState, online: navigator.onLine, worker: navigator.serviceWorker?.controller?.state ?? null })).catch(() => null);
    fs.writeFileSync(path.join(output, "failure-diagnostics.json"), JSON.stringify({ ...diagnostics.get(page), runtime }, null, 2));
  }
  process.exitCode = 1;
}).finally(async () => { await browser?.close(); await fixtureProxy?.close(); });
