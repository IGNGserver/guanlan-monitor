const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const projectRoot = path.resolve(__dirname, "..");
const desktopRoot = path.join(projectRoot, "apps", "desktop");
const outputDir = path.resolve(process.argv[2] ?? "artifacts/electron-visual-regression");
fs.mkdirSync(outputDir, { recursive: true });

function resolveElectronExecutable() {
  const electronManifest = require.resolve("electron/package.json", { paths: [desktopRoot] });
  const electronRoot = path.dirname(electronManifest);
  return path.join(electronRoot, "dist", process.platform === "win32" ? "electron.exe" : "electron");
}

async function readShellMetrics(page) {
  return page.evaluate(() => {
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
      viewportWidth: window.innerWidth,
      bridgeAvailable: Boolean(window.dsc && typeof window.dsc.getSnapshot === "function")
    };
  });
}

async function run() {
  let electronApp;
  const pageErrors = [];
  const consoleMessages = [];
  const failedRequests = [];
  const mainStderr = [];

  try {
    const executablePath = resolveElectronExecutable();
    assert.ok(fs.existsSync(executablePath), `Electron executable is missing: ${executablePath}`);
    electronApp = await electron.launch({
      executablePath,
      args: ["--no-sandbox", "--lang=en-US", desktopRoot],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        ELECTRON_DISABLE_SANDBOX: "1",
        NODE_ENV: "test",
        DSC_VISUAL_FIXTURE: "1"
      }
    });
    electronApp.process().stderr?.on("data", (chunk) => mainStderr.push(chunk.toString("utf8")));

    const page = await electronApp.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "unknown" }));
    await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(500);

    const desktopMetrics = await readShellMetrics(page);
    if (!desktopMetrics) {
      const diagnostics = {
        url: page.url(),
        bodyText: await page.locator("body").innerText().catch(() => ""),
        bodyHtml: await page.locator("body").innerHTML().catch(() => ""),
        pageErrors,
        consoleMessages,
        failedRequests,
        mainStderr: mainStderr.join("").slice(-8000)
      };
      fs.writeFileSync(path.join(outputDir, "electron-visual-regression-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
      console.error(JSON.stringify(diagnostics, null, 2));
    }
    assert.ok(desktopMetrics, "Electron shared workspace shell is missing");
    assert.equal(desktopMetrics.display, "grid");
    assert.equal(desktopMetrics.sidebarDisplay, "flex");
    assert.ok(desktopMetrics.sidebarWidth > 0);
    assert.ok(desktopMetrics.mainWidth > 0);
    assert.equal(desktopMetrics.bridgeAvailable, true, "Electron preload bridge is unavailable");
    assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth + 1, "Electron desktop shell overflows horizontally");
    assert.equal(await page.locator(".workspace-device-item").count(), 0, "Electron primary navigation must not contain a device list");
    const desktopNavLabels = (await page.locator(".workspace-sidebar .m3-navigation-item").allTextContents()).map((label) => label.trim());
    const expectedDesktopNav = desktopNavLabels.includes("本机 Agent") ? ["总览", "设备", "中枢状态", "本机 Agent", "设置"] : ["总览", "设备", "中枢状态", "设置"];
    assert.deepEqual(desktopNavLabels, expectedDesktopNav, "Electron primary navigation contains non-destination commands");
    await page.screenshot({ path: path.join(outputDir, "electron-workspace-desktop.png"), fullPage: true, animations: "disabled" });

    await page.locator(".workspace-sidebar .m3-navigation-item").filter({ hasText: "设备" }).click();
    await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
    const deviceTable = page.locator(".workspace-directory-surface .cds--data-table");
    assert.equal(await deviceTable.locator("tbody tr").count(), 3, "rich Electron fixture must render every device instance");
    assert.equal(await deviceTable.getByText("当前响应", { exact: true }).count(), 2, "online instances must expose current heartbeat facts");
    assert.equal(await deviceTable.getByText("心跳已过期", { exact: true }).count(), 1, "offline instances must expose stale heartbeat facts");
    await page.screenshot({ path: path.join(outputDir, "electron-devices-desktop.png"), fullPage: true, animations: "disabled" });

    await deviceTable.locator(".guanlan-table-link").filter({ hasText: "视觉验收虚拟机" }).click();
    await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator(".workspace-breadcrumb").getByText("设备", { exact: true }).count(), 1, "Electron detail must expose the device breadcrumb");
    assert.equal(await page.locator(".workspace-device-facts").count(), 1, "Electron detail must expose stable facts");
    assert.equal(await page.getByText(/宿主机 Agent\s*[:：]?\s*在线/).count(), 1, "Electron VM detail must separate host Agent state");
    await page.screenshot({ path: path.join(outputDir, "electron-device-vm-rich.png"), fullPage: true, animations: "disabled" });

    await page.evaluate(() => { window.location.hash = "#settings/general"; });
    await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({ path: path.join(outputDir, "electron-settings-desktop.png"), fullPage: true, animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
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
    assert.equal(mobileMetrics.bottomNavDisplay, "grid");
    assert.deepEqual((await page.locator(".workspace-bottom-nav__item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "连接", "设置"]);
    assert.ok(mobileMetrics.rootWidth > 0);
    assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "Electron narrow shell overflows horizontally");
    await page.evaluate(() => { window.location.hash = "#settings/appearance"; });
    await page.locator(".workspace-settings-mobile-nav").waitFor({ state: "visible", timeout: 5_000 });
    assert.ok(await page.locator(".workspace-settings-mobile-nav__list button").count() >= 2, "Electron compact settings must expose category navigation");
    await page.screenshot({ path: path.join(outputDir, "electron-workspace-mobile.png"), fullPage: true, animations: "disabled" });

    assert.deepEqual(pageErrors, [], `Electron renderer page errors: ${pageErrors.join("; ")}`);
    const report = {
      executablePath,
      desktopMetrics,
      mobileMetrics,
      screenshots: fs.readdirSync(outputDir).sort(),
      mainStderr: mainStderr.join("").slice(-4000)
    };
    fs.writeFileSync(path.join(outputDir, "electron-visual-regression-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (electronApp) await electronApp.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
