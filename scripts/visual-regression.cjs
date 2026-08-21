const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const outputDir = path.resolve(process.argv[3] ?? "artifacts/visual-regression");
fs.mkdirSync(outputDir, { recursive: true });

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/session") return fulfillJson(route, { ok: true, issuedAt: "2026-08-21T00:00:00.000Z" });
    if (pathname === "/api/instances") return fulfillJson(route, []);
    if (pathname === "/api/overview/metrics") return fulfillJson(route, { window: "5m", instances: [] });
    if (pathname === "/api/updates") {
      return fulfillJson(route, {
        available: false,
        currentVersion: "visual-test",
        currentChannel: "test",
        latestVersion: "visual-test",
        message: null,
        releaseUrl: null
      });
    }
    return fulfillJson(route, {});
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);

  const desktopMetrics = await page.evaluate(() => {
    const root = document.querySelector(".workspace-root");
    const sidebar = document.querySelector(".workspace-sidebar");
    const main = document.querySelector(".workspace-main");
    if (!root || !sidebar || !main) return null;
    const rootStyle = getComputedStyle(root);
    const sidebarStyle = getComputedStyle(sidebar);
    return {
      display: rootStyle.display,
      sidebarWidth: sidebar.getBoundingClientRect().width,
      sidebarDisplay: sidebarStyle.display,
      mainWidth: main.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  assert.ok(desktopMetrics, "shared workspace shell is missing");
  assert.equal(desktopMetrics.display, "grid");
  assert.equal(desktopMetrics.sidebarDisplay, "flex");
  assert.ok(desktopMetrics.sidebarWidth > 0);
  assert.ok(desktopMetrics.mainWidth > 0);
  assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth + 1, "desktop shell overflows horizontally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-desktop.png"), fullPage: true, animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);
  const mobileMetrics = await page.evaluate(() => {
    const root = document.querySelector(".workspace-root");
    const bottomNav = document.querySelector(".workspace-bottom-nav");
    return {
      rootWidth: root?.getBoundingClientRect().width ?? 0,
      bottomNavDisplay: bottomNav ? getComputedStyle(bottomNav).display : "missing",
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  assert.equal(mobileMetrics.bottomNavDisplay, "flex");
  assert.ok(mobileMetrics.rootWidth > 0);
  assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "mobile shell overflows horizontally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-mobile.png"), fullPage: true, animations: "disabled" });

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
  await browser.close();
  console.log(JSON.stringify({ baseUrl, desktopMetrics, mobileMetrics, screenshots: fs.readdirSync(outputDir).sort() }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
