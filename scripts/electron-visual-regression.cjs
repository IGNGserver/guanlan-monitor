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
  const mainStderr = [];

  try {
    const executablePath = resolveElectronExecutable();
    assert.ok(fs.existsSync(executablePath), `Electron executable is missing: ${executablePath}`);
    electronApp = await electron.launch({
      executablePath,
      args: [desktopRoot],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        NODE_ENV: "test"
      }
    });
    electronApp.process().stderr?.on("data", (chunk) => mainStderr.push(chunk.toString("utf8")));

    const page = await electronApp.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(500);

    const desktopMetrics = await readShellMetrics(page);
    assert.ok(desktopMetrics, "Electron shared workspace shell is missing");
    assert.equal(desktopMetrics.display, "grid");
    assert.equal(desktopMetrics.sidebarDisplay, "flex");
    assert.ok(desktopMetrics.sidebarWidth > 0);
    assert.ok(desktopMetrics.mainWidth > 0);
    assert.equal(desktopMetrics.bridgeAvailable, true, "Electron preload bridge is unavailable");
    assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth + 1, "Electron desktop shell overflows horizontally");
    await page.screenshot({ path: path.join(outputDir, "electron-workspace-desktop.png"), fullPage: true, animations: "disabled" });

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
    assert.equal(mobileMetrics.bottomNavDisplay, "flex");
    assert.ok(mobileMetrics.rootWidth > 0);
    assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "Electron narrow shell overflows horizontally");
    await page.screenshot({ path: path.join(outputDir, "electron-workspace-mobile.png"), fullPage: true, animations: "disabled" });

    assert.deepEqual(pageErrors, [], `Electron renderer page errors: ${pageErrors.join("; ")}`);
    console.log(JSON.stringify({
      executablePath,
      desktopMetrics,
      mobileMetrics,
      screenshots: fs.readdirSync(outputDir).sort(),
      mainStderr: mainStderr.join("").slice(-4000)
    }, null, 2));
  } finally {
    if (electronApp) await electronApp.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
