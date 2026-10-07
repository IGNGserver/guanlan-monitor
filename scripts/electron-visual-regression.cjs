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
    const theme = document.querySelector(".m3e-theme");
    const content = document.querySelector(".workspace-content");
    const windowbar = document.querySelector(".workspace-windowbar");
    const caption = document.querySelector(".workspace-caption-button");
    return {
      display: rootStyle.display,
      sidebarWidth: sidebar.getBoundingClientRect().width,
      sidebarDisplay: sidebarStyle.display,
      mainWidth: main.getBoundingClientRect().width,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      bridgeAvailable: Boolean(window.dsc && typeof window.dsc.getSnapshot === "function"),
      // The shell must be a bounded frame, not a document that grows with its
      // content. A `min-height`-only theme wrapper left `.workspace-content` at
      // `clientHeight === scrollHeight`, which silently disabled page scrolling
      // and `sticky` positioning.
      themeHeight: theme ? Math.round(theme.getBoundingClientRect().height) : null,
      contentScrollable: Boolean(content && content.scrollHeight > content.clientHeight + 1),
      contentFitsViewport: Boolean(content) && Math.round(content.getBoundingClientRect().height) <= window.innerHeight + 1,
      windowbarHeight: windowbar ? Math.round(windowbar.getBoundingClientRect().height) : null,
      captionButton: caption ? {
        width: Math.round(caption.getBoundingClientRect().width),
        height: Math.round(caption.getBoundingClientRect().height),
        glyphPaths: caption.querySelectorAll("svg path").length,
        glyphData: caption.querySelector("svg path")?.getAttribute("d") ?? ""
      } : null
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

    // Bounded shell frame. If the theme wrapper goes back to `min-height` only,
    // the root grows to its content and the page scroller is disabled — that was
    // the "nothing scrolls, and the last row is never reachable" defect.
    assert.equal(desktopMetrics.themeHeight, desktopMetrics.viewportHeight, "the themed wrapper must be viewport-height, not content-height");
    assert.equal(desktopMetrics.contentFitsViewport, true, "the content scroller must fit the viewport, not grow with the page");
    assert.equal(desktopMetrics.contentScrollable, true, "the overview page must produce a real scroll range");

    // Caption buttons: 32px tall (the Windows title bar), and the maximize
    // button must carry a real glyph rather than an empty <svg>.
    assert.equal(desktopMetrics.windowbarHeight, 32, `the native title bar must be 32px tall (measured ${desktopMetrics.windowbarHeight})`);
    assert.ok(desktopMetrics.captionButton, "the native title bar must render caption buttons");
    assert.equal(desktopMetrics.captionButton.height, 32, `caption buttons must be 32px tall (measured ${desktopMetrics.captionButton.height})`);
    assert.equal(desktopMetrics.captionButton.width, 46, `caption buttons must be 46px wide (measured ${desktopMetrics.captionButton.width})`);
    assert.equal(desktopMetrics.captionButton.glyphPaths, 1, "each caption button must draw exactly one glyph path");
    assert.ok(desktopMetrics.captionButton.glyphData.length > 0, "the minimize glyph path is empty");
    assert.equal(await page.locator(".workspace-device-item").count(), 0, "Electron primary navigation must not contain a device list");
    const desktopNavLabels = (await page.locator(".workspace-sidebar .m3e-nav-item").allTextContents()).map((label) => label.trim());
    const expectedDesktopNav = desktopNavLabels.includes("连接与本机") ? ["总览", "设备", "连接与本机", "设置"] : ["总览", "设备", "设置"];
    assert.deepEqual(desktopNavLabels, expectedDesktopNav, "Electron primary navigation contains non-destination commands");
    await page.screenshot({ path: path.join(outputDir, "electron-workspace-desktop.png"), fullPage: true, animations: "disabled" });

    await page.locator(".workspace-sidebar .m3e-nav-item").filter({ hasText: "设备" }).click();
    await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
    const deviceTable = page.locator(".workspace-directory-surface .m3e-table");
    assert.equal(await deviceTable.locator("tbody tr").count(), 2, "Electron fixture must render every device");
    assert.equal(await deviceTable.getByText("刚刚上报", { exact: true }).count(), 1, "online devices must expose their latest report");
    assert.equal(await deviceTable.getByText("已停止上报", { exact: true }).count(), 1, "offline devices must say that reporting stopped");
    // 一台不可达的设备在桌面端也只有一个名字：目录、筛选与总览都说「离线」。
    assert.equal(await deviceTable.getByText("离线", { exact: true }).count(), 1, "an unreachable device is tagged 离线 in the desktop directory");
    assert.doesNotMatch(await deviceTable.innerText(), /未响应/, "the desktop directory must not invent a second name for an offline device");
    // 表格百分比与图表共用同一个取整规则（中枢会回 28.4 这种原值）。
    assert.equal((await deviceTable.locator("tbody tr").first().locator("td").nth(2).innerText()).trim(), "28%", "desktop directory percentages must round like the charts");
    await page.screenshot({ path: path.join(outputDir, "electron-devices-desktop.png"), fullPage: true, animations: "disabled" });

    await deviceTable.locator(".guanlan-table-link").filter({ hasText: "视觉验收主机" }).click();
    await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator(".workspace-breadcrumb").getByText("设备", { exact: true }).count(), 1, "Electron detail must expose the device breadcrumb");
    assert.equal(await page.locator(".workspace-device-facts").count(), 1, "Electron detail must expose stable facts");
    await page.screenshot({ path: path.join(outputDir, "electron-device-rich.png"), fullPage: true, animations: "disabled" });

    await page.evaluate(() => { window.location.hash = "#settings/general"; });
    await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
    // The desktop-only connection page also owns the local Agent controls.
    assert.deepEqual(
      (await page.locator(".workspace-sidebar__nav .workspace-nav-item .m3e-nav-item__label").allTextContents()).map((label) => label.trim()),
      ["通用", "外观", "连接与本机", "数据与更新", "快捷键参考", "关于观澜"],
      "desktop settings must use the shared section vocabulary"
    );
    await page.screenshot({ path: path.join(outputDir, "electron-settings-desktop.png"), fullPage: true, animations: "disabled" });

    // The keyboard reference must name this client's keys: no F5 (there is no
    // browser reload), and the hide-to-tray shortcut only exists here.
    await page.evaluate(() => { window.location.hash = "#settings/shortcuts"; });
    await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
    const desktopShortcutKeys = (await page.locator(".workspace-shortcut-row kbd").allTextContents()).map((key) => key.trim());
    const desktopShortcutDescriptions = (await page.locator(".workspace-shortcut-row span").allTextContents()).map((text) => text.trim());
    assert.ok(desktopShortcutKeys.every((key) => !key.startsWith("F5")), `the native client must not advertise a browser reload key (${desktopShortcutKeys.join(",")})`);
    assert.ok(desktopShortcutDescriptions.some((text) => text.includes("托盘")), `the native client owns a hide-to-tray shortcut (${desktopShortcutDescriptions.join(",")})`);
    assert.equal(await page.locator(".workspace-shortcut-row").count(), 6, "the desktop reference lists the five console shortcuts plus hide-to-tray");
    await page.screenshot({ path: path.join(outputDir, "electron-settings-shortcuts.png"), fullPage: true, animations: "disabled" });

    // The diagnostics surface is the one thing the browser console cannot have.
    // It exists because these fields used to be collected by the main process and
    // rendered nowhere; the assertion is on the *rendered rows*, so a field that
    // stops reaching the page fails here rather than silently disappearing.
    await page.evaluate(() => { window.location.hash = "#settings/agent"; });
    await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator(".workspace-agent-diagnostics").count(), 1, "the legacy Agent hash must open the combined page with diagnostics");
    assert.equal(await page.getByRole("button", { name: "保存设备名称" }).count(), 1, "the combined page must expose an explicit device-name save button");
    const diagnosticLabels = (await page.locator(".workspace-agent-diagnostics .workspace-summary-row span").allTextContents()).map((label) => label.trim());
    for (const label of ["Agent 启动于", "采集进程启动于", "自动重启", "最近退出", "最近重启", "自动重启挂起", "最近硬件检测", "最近成功上传", "最近同步到中枢", "云配置同步", "最老待上传样本"]) {
      assert.ok(diagnosticLabels.includes(label), `the desktop diagnostics surface is missing the "${label}" row (${diagnosticLabels.join(",")})`);
    }
    // The storage paths live in a collapsed <details>. `count()` sees hidden DOM,
    // so assert they become visible only after the summary is opened — that is
    // what proves the disclosure actually works.
    const storageRow = page.locator(".workspace-agent-diagnostics .workspace-summary-row").filter({ hasText: "采集日志" });
    assert.equal(await storageRow.count(), 1, "the storage section must expose the diagnostics log path");
    await page.locator(".workspace-agent-diagnostics .workspace-advanced__summary").click();
    await storageRow.waitFor({ state: "visible", timeout: 5_000 });
    const storageLabels = (await page.locator(".workspace-agent-diagnostics .workspace-summary-row span").allTextContents()).map((label) => label.trim());
    for (const label of ["配置文件", "同步状态", "待上传队列", "采集日志"]) {
      assert.ok(storageLabels.includes(label), `the storage section is missing the "${label}" row (${storageLabels.join(",")})`);
    }
    assert.equal(await page.getByRole("button", { name: "复制诊断信息" }).count(), 1, "the diagnostics surface must offer the redacted export");
    await page.screenshot({ path: path.join(outputDir, "electron-agent-diagnostics.png"), fullPage: true, animations: "disabled" });
    await page.evaluate(() => { window.location.hash = "#settings/data"; });
    await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
    const dataSettingsText = await page.locator(".workspace-page--settings").innerText();
    // The desktop shell polls through the host bridge; it must not borrow the
    // browser's 实时 claim for the same live snapshot. 数据来源 lives on the
    // 数据与更新 page for the native client (the browser also shows it on 通用).
    assert.ok(dataSettingsText.includes("定时刷新"), `the polling client must label live data 定时刷新 (${dataSettingsText})`);
    assert.ok(!dataSettingsText.includes("实时连接"), "the polling client must not describe itself as realtime");

    // A narrow native window renders the touch shell, keeping its caption bar.
    // The desktop shell's own phone mode (drawer, bottom bar, settings jump list)
    // is gone.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".touch-workspace").waitFor({ state: "visible", timeout: 15_000 });
    const mobileMetrics = await page.evaluate(() => {
      const root = document.querySelector(".touch-workspace");
      const caption = document.querySelector(".touch-workspace .workspace-windowbar");
      const buttons = [...document.querySelectorAll(".touch-workspace .workspace-caption-button")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      });
      return {
        rootWidth: root?.getBoundingClientRect().width ?? 0,
        presentation: root?.getAttribute("data-presentation") ?? "",
        captionHeight: Math.round(caption?.getBoundingClientRect().height ?? 0),
        captionButtons: buttons,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth
      };
    });
    assert.equal(mobileMetrics.presentation, "phone", "a 390px native window must use the phone layout");
    assert.equal(mobileMetrics.captionHeight, 32, "the narrow window keeps its 32px caption bar");
    assert.equal(mobileMetrics.captionButtons.length, 3, "minimize, maximize and hide stay reachable in a narrow window");
    assert.ok(mobileMetrics.captionButtons.every((button) => button.height === 32 && button.width <= 46), `caption buttons keep the OS geometry (${JSON.stringify(mobileMetrics.captionButtons)})`);
    assert.deepEqual((await page.locator(".touch-navigation button").allTextContents()).map((label) => label.trim()), ["总览", "设备", "设置"], "compact destinations must match the desktop rail");
    assert.equal(await page.locator(".workspace-root").count(), 0, "the desktop shell must not render in a narrow window");
    assert.ok(mobileMetrics.rootWidth > 0);
    assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "Electron narrow shell overflows horizontally");
    await page.evaluate(() => { window.location.hash = "#settings/appearance"; });
    await page.locator(".touch-settings").waitFor({ state: "visible", timeout: 5_000 });
    await page.getByRole("button", { name: "返回设置分类" }).click();
    assert.ok(await page.locator(".touch-category-list button").count() >= 2, "Electron compact settings must expose category navigation");
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
