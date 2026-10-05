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
async function waitForLayout(page) {
  // React classes can be visible to the test before container layout and resize
  // observers reach the next rendered frame. Sample after those frames settle.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function measuredCharts(page) {
  await waitForLayout(page);
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
async function measuredShell(page) {
  await waitForLayout(page);
  // The rail's width transition (0.01 ms under reduced motion) still settles a
  // frame after the root class flips: the class can read "open" while the grid
  // track is the rail's 88px. Measure only once the shell geometry has held for
  // two consecutive frames, instead of after a fixed number of frames.
  await page.waitForFunction(() => new Promise((resolve) => {
    const read = () => {
      const root = document.querySelector(".workspace-root");
      const sidebar = document.querySelector(".workspace-sidebar");
      return `${getComputedStyle(root).gridTemplateColumns}|${Math.round(sidebar.getBoundingClientRect().width)}`;
    };
    const first = read();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(read() === first)));
  }));
  return page.evaluate(() => {
    const root = document.querySelector(".workspace-root");
    const sidebar = document.querySelector(".workspace-sidebar").getBoundingClientRect();
    const main = document.querySelector(".workspace-main").getBoundingClientRect();
    return { viewportWidth: window.innerWidth, classes: root.className, tracks: getComputedStyle(root).gridTemplateColumns, sidebar: { width: sidebar.width, right: sidebar.right }, main: { width: main.width, left: main.left } };
  });
}
function assertChartColumns(layout, columns) {
  const ordinary = layout.filter((grid) => grid.cells.length > 1);
  assert.ok(ordinary.length > 0, "the fixture must include multiple ordinary charts");
  for (const grid of ordinary) {
    const [first, second] = grid.cells;
    if (columns === 2) {
      assert.ok(Math.abs(first.top - second.top) < 2, "ordinary charts must share a row: " + JSON.stringify(grid));
      assert.ok(second.left >= first.left + first.width, "ordinary charts must sit beside each other: " + JSON.stringify(grid));
    } else {
      assert.ok(Math.abs(first.left - second.left) < 2 && second.top > first.top, "phone charts must stack: " + JSON.stringify(grid));
      assert.ok(grid.cells.every((cell) => Math.abs(cell.width - grid.width) < 2), "phone charts must fill their single column: " + JSON.stringify(grid));
    }
  }
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
  await sheetChecks(page, cell);
  await measuredCharts(page);
}
async function sheetChecks(page, cell) {
  // Supporting text lives in the half sheet; the card itself keeps title, reading and chart.
  assert.equal(await cell.locator(".chart-tile__subtitle, .chart-tile__footer").count(), 0, "supporting text must move into the detail sheet");
  const sheet = cell.locator(".chart-tile__sheet");
  assert.equal(await sheet.evaluate((el) => el.inert), true, "a closed sheet must stay out of the tab order");
  await cell.getByRole("button", { name: "展开", exact: true }).click();
  const collapse = cell.getByRole("button", { name: "收回", exact: true });
  assert.equal(await collapse.getAttribute("aria-expanded"), "true");
  await sheet.locator(".chart-sheet").waitFor();
  await page.waitForFunction((el) => getComputedStyle(el).visibility === "visible" && getComputedStyle(el).opacity === "1", await sheet.elementHandle());
  assert.equal(await sheet.evaluate((el) => el.inert), false);
  const geometry = await cell.evaluate((tile) => {
    const box = tile.getBoundingClientRect();
    const header = tile.querySelector(".chart-tile__header").getBoundingClientRect();
    const sheetBox = tile.querySelector(".chart-tile__sheet").getBoundingClientRect();
    return { tileTop: box.top, tileBottom: box.bottom, headerBottom: header.bottom, sheetTop: sheetBox.top };
  });
  const covered = (geometry.tileBottom - geometry.sheetTop) / (geometry.tileBottom - geometry.tileTop);
  assert.ok(geometry.sheetTop >= geometry.headerBottom - 1, "the sheet must leave the title and collapse button visible: " + JSON.stringify(geometry));
  assert.ok(covered >= 0.45, "the sheet must cover about half of the card: " + JSON.stringify({ covered, ...geometry }));
  assert.equal(await cell.locator(".m3e-chart-readout").count(), 1, "the reading stays on the card while the sheet is open");
  await page.screenshot({ path: path.join(output, "chart-sheet-" + report.checks.length + ".png") });
  report.checks.push({ sheet: { covered: Number(covered.toFixed(3)), ...geometry } });
  // Escape from the toggle closes the sheet and keeps focus on the toggle.
  await collapse.focus();
  await page.keyboard.press("Escape");
  await cell.locator('.chart-tile__sheet[data-open="false"]').waitFor({ state: "attached" });
  assert.equal(await cell.getByRole("button", { name: "展开", exact: true }).evaluate((el) => el === document.activeElement), true);
  assert.equal(await sheet.evaluate((el) => el.inert), true);
  await cell.getByRole("button", { name: "展开", exact: true }).click();
  await cell.getByRole("button", { name: "收回", exact: true }).click();
  await cell.locator('.chart-tile__sheet[data-open="false"]').waitFor({ state: "attached" });
}
async function desktopFlow() {
  const { page, context, errors } = await setup();
  console.log("Checking desktop layout, chart measurements and collapsed navigation");
  await page.getByRole("tab", { name: "计算与系统", exact: true }).click();
  await page.locator('.m3e-chart__svg[aria-label*="使用率"]').first().waitFor();
  // 390px renders the touch shell for every client now; the phone chart layout
  // is measured in touchFlow below rather than by shrinking this desktop page.
  for (const width of [1920, 1280, 1024, 840]) {
    await page.setViewportSize({ width, height: 900 });
    report.layouts.push({ width, layout: await measuredCharts(page) });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  const collapse = page.locator(".workspace-sidebar__collapse");
  await collapse.waitFor();
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar__collapse')?.getAttribute('aria-label') === '折叠侧边栏');
  const expandedShell = await measuredShell(page);
  const expandedLayout = await measuredCharts(page);
  report.layouts.push({ width: 1024, collapsed: false, shell: expandedShell, layout: expandedLayout });
  await collapse.click();
  await page.locator('.workspace-root.is-sidebar-collapsed').waitFor();
  await page.mouse.move(600, 20);
  assert.equal(await page.locator(".workspace-sidebar .workspace-nav-item .m3e-nav-item__icon").first().isVisible(), true);
  await page.locator(".workspace-sidebar .workspace-nav-item .m3e-nav-item__label").first().waitFor({ state: "hidden" });
  assert.equal(await page.locator(".workspace-sidebar").getByRole("button", { name: "设备", exact: true }).count(), 1);
  const collapsedShell = await measuredShell(page);
  const collapsedLayout = await measuredCharts(page);
  const releasedWidth = expandedShell.sidebar.width - collapsedShell.sidebar.width;
  assert.ok(releasedWidth > 100, "collapsing the sidebar must release useful space");
  assert.ok(Math.abs(collapsedShell.main.left - collapsedShell.sidebar.right) < 2, "content must start at the rail edge: " + JSON.stringify(collapsedShell));
  assert.ok(Math.abs(collapsedShell.main.width - expandedShell.main.width - releasedWidth) < 2, "content must receive the width released by the sidebar");
  assert.ok(Math.abs(collapsedLayout[0].width - expandedLayout[0].width - releasedWidth) < 2, "charts must receive the width released by the sidebar");
  assertChartColumns(collapsedLayout, 2);
  report.layouts.push({ width: 1024, collapsed: true, shell: collapsedShell, layout: collapsedLayout });
  for (const width of [1280, 840]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await measuredCharts(page);
    assertChartColumns(layout, 2);
    report.layouts.push({ width, collapsed: true, shell: await measuredShell(page), layout });
  }
  await page.setViewportSize({ width: 1024, height: 900 });
  await collapse.click();
  await page.locator('.workspace-root.is-sidebar-open').waitFor();
  const restoredShell = await measuredShell(page);
  assert.ok(Math.abs(restoredShell.main.width - expandedShell.main.width) < 2, "expanding must restore the original content width: " + JSON.stringify({ expandedShell, restoredShell }));
  const restoredLayout = await measuredCharts(page);
  assertChartColumns(restoredLayout, 1);
  report.layouts.push({ width: 1024, collapsed: false, restored: true, shell: restoredShell, layout: restoredLayout });
  await collapse.click();
  await page.locator('.workspace-root.is-sidebar-collapsed').waitFor();
  assertChartColumns(await measuredCharts(page), 2);
  // Show the ordinary trend cards themselves, below the static processor facts.
  await page.locator('.dashboard-grid').nth(1).evaluate((grid) => {
    const pane = grid.closest('.workspace-content');
    pane.scrollTop += grid.getBoundingClientRect().top - pane.getBoundingClientRect().top - 140;
  });
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
  report.checks.push("empty/loading mount, responsive SVG, 4/8/16 container grid, sidebar space reclamation and restored width, actual two-column cards at 840/1024/1280, rail icons and names, all-curve timestamp inspection, mouse and keyboard focus, half detail sheet open/Escape/collapse, native select change contract, light/dark popup");
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
  const phoneLayout = await measuredCharts(page);
  assertChartColumns(phoneLayout, 1);
  report.layouts.push({ width: 390, touch: true, layout: phoneLayout });
  await svg.scrollIntoViewIfNeeded();
  assert.match(await svg.evaluate((el) => getComputedStyle(el).touchAction), /pan-y/);
  const bounds = await svg.boundingBox();
  await page.touchscreen.tap(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6);
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor();
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 1);
  await page.locator(".touch-device-heading h1").tap();
  await cell.locator(".m3e-chart-readout.is-inspecting").waitFor({ state: "detached" });
  assert.equal(await cell.locator(".m3e-chart-readout.is-inspecting").count(), 0);
  await cell.getByRole("button", { name: "展开", exact: true }).tap();
  await cell.locator(".chart-sheet").waitFor();
  await page.screenshot({ path: path.join(output, "phone-chart-sheet.png") });
  await cell.getByRole("button", { name: "收回", exact: true }).tap();
  await cell.locator('.chart-tile__sheet[data-open="false"]').waitFor({ state: "attached" });
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
    fs.writeFileSync(path.join(output, "failure-report.json"), JSON.stringify(report, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally { await browser?.close(); await proxy?.close(); }
})();
