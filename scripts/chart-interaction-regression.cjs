const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require("playwright");
const { fixtureDevices, metricFixture } = require("./fixtures/web-console.cjs");
const { createFixtureProxy } = require("./fixtures/web-hub.cjs");
const upstream = process.argv[2] ?? "http://127.0.0.1:3000";
const output = path.resolve(process.argv[3] ?? ".codex-artifacts/chart-interaction");
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const report = { engine, checks: [], layouts: [] };
let browser;
let proxy;
let activePage;
fs.mkdirSync(output, { recursive: true });

function gapFixture(device) {
  const data = metricFixture(device);
  data.series.networks[0].txBytesPerSec.splice(1, 1);
  data.series.networkTxBytesPerSec.splice(1, 1);
  return data;
}
async function setup(touch = false) {
  const context = await browser.newContext({
    viewport: { width: touch ? 390 : 1280, height: 900 },
    screen: { width: touch ? 390 : 1280, height: 900 },
    hasTouch: touch, isMobile: touch, reducedMotion: "reduce", serviceWorkers: "block",
    ...(touch ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" } : {})
  });
  if (!touch) await context.addInitScript(() => localStorage.setItem("dsc-web-layout", "desktop"));
  const scenario = { mode: "live", devices: structuredClone(fixtureDevices), mutations: [], delayId: "workstation-01", metricFixture: gapFixture };
  await context.addCookies([{ name: "dsc-fixture", value: proxy.register(scenario), url: proxy.url }]);
  const page = await context.newPage();
  activePage = page;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(180_000);
  await page.goto(proxy.url + "#device/workstation-01", { waitUntil: "domcontentloaded" });
  await page.locator(touch ? ".touch-device-heading" : ".workspace-device-facts").waitFor();
  return { page, context, errors };
}
async function measuredCharts(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".m3e-chart__svg")].every((svg) => Math.abs(svg.viewBox.baseVal.width - svg.getBoundingClientRect().width) < 2));
  const layout = await page.evaluate(() => [...document.querySelectorAll(".dashboard-grid")].map((grid) => ({
    width: grid.clientWidth, scrollWidth: grid.scrollWidth,
    tracks: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    cells: [...grid.children].map((cell) => ({ width: cell.getBoundingClientRect().width, left: cell.getBoundingClientRect().left, top: cell.getBoundingClientRect().top }))
  })));
  for (const grid of layout) {
    assert.ok(grid.scrollWidth <= grid.width + 2, JSON.stringify(grid));
    assert.equal(grid.tracks, grid.width >= 1328 ? 16 : grid.width >= 656 ? 8 : 4, JSON.stringify(grid));
    assert.ok(grid.cells.every((cell) => cell.width <= grid.width + 2), JSON.stringify(grid));
  }
  return layout;
}
async function chartChecks(page, cell) {
  const svg = cell.locator(".m3e-chart__svg");
  await svg.scrollIntoViewIfNeeded();
  await svg.focus();
  await svg.press("Home");
  await page.waitForFunction(() => document.querySelector('.m3e-chart-readout.is-inspecting time')?.dateTime === '2026-09-13T09:56:00.000Z');
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 1);
  const first = await cell.locator(".m3e-chart-readout time").getAttribute("datetime");
  assert.equal(await svg.evaluate((el) => getComputedStyle(el).outlineStyle), "solid", "keyboard focus must stay visible");
  await svg.press("End");
  await page.waitForFunction(() => document.querySelector('.m3e-chart-readout.is-inspecting time')?.dateTime === '2026-09-13T10:00:00.000Z');
  const last = await cell.locator(".m3e-chart-readout time").getAttribute("datetime");
  assert.ok(Date.parse(last) > Date.parse(first));
  const latest = await cell.locator(".m3e-chart-readout dd").allTextContents();
  await svg.press("ArrowLeft");
  await page.waitForFunction(() => document.querySelector('.m3e-chart-readout.is-inspecting time')?.dateTime === '2026-09-13T09:58:00.000Z');
  const middle = await cell.locator(".m3e-chart-readout dd").allTextContents();
  assert.match(middle[0], /MB\/s/);
  assert.equal(middle[1], "—");
  assert.equal(await svg.locator(".m3e-chart__hover circle").count(), 1, "missing uploads must not borrow a point with the same array index");
  await svg.press("Escape");
  await cell.locator('.m3e-chart-readout.is-inspecting').waitFor({ state: 'detached' });
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 0);
  assert.deepEqual(await cell.locator(".m3e-chart-readout dd").allTextContents(), latest);
  const bounds = await svg.boundingBox();
  // Derive the plotting bounds from the actual grid so unit-label padding can change.
  const plot = await svg.locator(".m3e-chart__grid").first().evaluate((line) => ({ left: Number(line.getAttribute("x1")), right: Number(line.getAttribute("x2")) }));
  await page.mouse.move(bounds.x + (plot.left + plot.right) / 2, bounds.y + bounds.height / 2);
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor();
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 1);
  assert.equal(await svg.locator(".m3e-chart__hover circle").count(), 1);
  await page.mouse.click(bounds.x + (plot.left + plot.right) / 2, bounds.y + bounds.height / 2);
  assert.equal(await svg.evaluate((el) => getComputedStyle(el).outlineStyle), "none", "pointer clicks must not leave a chart frame");
  await page.mouse.move(5, 5);
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor({ state: "detached" });
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 0);
  await cell.getByRole("button", { name: "详细信息", exact: true }).click();
  assert.equal(await cell.locator(".m3e-chart-readout").count(), 0);
  await page.getByRole("button", { name: "返回图表", exact: true }).click();
  await measuredCharts(page);
}
async function desktopFlow() {
  const { page, context, errors } = await setup();
  console.log("Checking desktop layout, chart measurements and collapsed navigation");
  await page.getByRole("tab", { name: "计算与系统", exact: true }).click();
  await page.locator('.m3e-chart__svg[aria-label*="使用率"]').first().waitFor();
  for (const width of [1280, 1024, 840, 390]) {
    await page.setViewportSize({ width, height: 900 });
    report.layouts.push({ width, layout: await measuredCharts(page) });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  const collapse = page.locator(".workspace-sidebar__collapse");
  await collapse.waitFor();
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar__collapse')?.getAttribute('aria-label') === '折叠侧边栏');
  await collapse.click();
  await page.locator('.workspace-sidebar.is-collapsed').waitFor();
  await page.mouse.move(600, 20);
  assert.equal(await page.locator(".workspace-sidebar .workspace-nav-item .m3e-nav-item__icon").first().isVisible(), true);
  await page.locator(".workspace-sidebar .workspace-nav-item .m3e-nav-item__label").first().waitFor({ state: "hidden" });
  assert.equal(await page.locator(".workspace-sidebar").getByRole("button", { name: "设备", exact: true }).count(), 1);
  report.layouts.push({ width: 1024, collapsed: true, layout: await measuredCharts(page) });
  await page.screenshot({ path: path.join(output, "desktop-two-columns.png") });
  await page.getByRole("tab", { name: "网络", exact: true }).click();
  const network = page.locator('.chart-tile').filter({ has: page.locator('.m3e-chart__svg[aria-label*="接收 (Rx)"]') }).first();
  await network.locator(".m3e-chart__svg").waitFor();
  await measuredCharts(page);
  await chartChecks(page, network);
  await page.screenshot({ path: path.join(output, "network-chart.png") });
  await page.goto(proxy.url + "#devices", { waitUntil: "domcontentloaded" });
  const sort = page.getByRole("combobox", { name: "排序", exact: true });
  await sort.waitFor();
  console.log("Checking themed select keyboard selection, cancel and dismissal");
  const before = await sort.locator("..").locator("select").inputValue();
  await sort.focus();
  await sort.press("ArrowDown");
  await sort.press("End");
  await sort.press("Escape");
  assert.equal(await sort.locator("..").locator("select").inputValue(), before);
  await sort.press("ArrowDown");
  await sort.press("End");
  await sort.press("Enter");
  assert.equal(await sort.locator("..").locator("select").inputValue(), "lastSeen");
  assert.match(await sort.innerText(), /最后在线/);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-dsc-resolved-theme", value), theme);
    await sort.click();
    const menu = page.getByRole("listbox", { name: "排序", exact: true });
    await menu.waitFor();
    const metrics = await menu.evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius, right: el.getBoundingClientRect().right, top: el.getBoundingClientRect().top }));
    assert.notEqual(metrics.background, "rgba(0, 0, 0, 0)");
    assert.equal(metrics.radius, "16px");
    assert.ok(metrics.top >= 0 && metrics.right <= 1024);
    report.checks.push({ theme, menu: metrics });
    await page.screenshot({ path: path.join(output, `select-${theme}.png`) });
    await page.locator(".workspace-page-intro h2").click();
    await menu.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-controls]')?.getAttribute("aria-expanded") === "false");
  }
  assert.deepEqual(errors, []);
  report.checks.push("empty/loading mount, responsive SVG, 4/8/16 container grid, rail icons and names, all-curve timestamp inspection, mouse and keyboard focus, details remount, native select change contract, light/dark popup");
  await context.close();
}
async function swipe(page, svg, horizontal) {
  const bounds = await svg.boundingBox();
  const session = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width * 0.65;
  const y = bounds.y + bounds.height * 0.6;
  const point = (step) => ({ x: horizontal ? x - step * 18 : x, y: horizontal ? y : y - step * 18, id: 1 });
  try {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(0)] });
    for (let step = 1; step <= 6; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(step)] });
      await page.waitForTimeout(24);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await session.detach(); }
}
async function touchFlow() {
  const { page, context, errors } = await setup(true);
  console.log("Checking phone chart, popup touch selection and scroll gestures");
  await page.getByRole("tab", { name: "趋势", exact: true }).tap();
  const category = page.getByRole("combobox", { name: "趋势分类", exact: true });
  await category.tap();
  await page.getByRole("listbox", { name: "趋势分类", exact: true }).getByRole("option", { name: "计算与系统", exact: true }).tap();
  assert.equal(await category.locator("..").locator("select").inputValue(), "compute");
  const cell = page.locator('.chart-tile').filter({ has: page.locator('.m3e-chart__svg[aria-label*="使用率"]') }).first();
  const svg = cell.locator(".m3e-chart__svg");
  await svg.waitFor();
  await measuredCharts(page);
  await svg.scrollIntoViewIfNeeded();
  assert.match(await svg.evaluate((el) => getComputedStyle(el).touchAction), /pan-y/);
  const bounds = await svg.boundingBox();
  await page.touchscreen.tap(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6);
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor();
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 1);
  await page.locator(".touch-device-heading h1").tap();
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor({ state: "detached" });
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 0);
  await svg.scrollIntoViewIfNeeded();
  if (engine === "chromium") {
    const pane = page.locator(".touch-main-pane");
    const initialScroll = await pane.evaluate((el) => el.scrollTop);
    await swipe(page, svg, true);
    assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 1, "horizontal touch must retain its readout after release");
    assert.ok(Math.abs(await pane.evaluate((el) => el.scrollTop) - initialScroll) < 2, "horizontal inspection must not scroll the page");
    await swipe(page, svg, false);
    await page.waitForFunction((initial) => document.querySelector(".touch-main-pane").scrollTop > initial + 20, initialScroll);
    assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 0, "vertical scrolling must not inspect on release");
    report.checks.push("Chromium native touch: horizontal inspection persists without page motion; vertical gesture scrolls the page and clears inspection");
  }
  await page.screenshot({ path: path.join(output, "phone-chart.png") });
  assert.deepEqual(errors, []);
  report.checks.push("phone single column, touch dropdown selection, tap inspection and outside dismissal, vertical touch-action contract");
  await context.close();
}
(async () => {
  try {
    proxy = await createFixtureProxy(upstream);
    browser = await (engine === "webkit" ? webkit : chromium).launch({ headless: true });
    await desktopFlow();
    await touchFlow();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log("Chart interaction regression passed (" + engine + ")");
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
      fs.writeFileSync(path.join(output, "failure.html"), await activePage.content().catch(() => ""));
    }
    console.error(error);
    process.exitCode = 1;
  } finally { await browser?.close(); await proxy?.close(); }
})();
