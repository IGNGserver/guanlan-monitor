const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const executablePath = path.resolve(process.argv[2] ?? "");
const outputDir = path.resolve(process.argv[3] ?? "artifacts/electron-release-acceptance");
fs.mkdirSync(outputDir, { recursive: true });

async function run() {
  assert.ok(executablePath && fs.existsSync(executablePath), `installed Guanlan executable is missing: ${executablePath}`);
  const app = await electron.launch({
    executablePath,
    args: ["--dsc-release-acceptance"],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 20_000 });
    const evidence = {
      executablePath,
      version: process.env.DSC_RELEASE_VERSION ?? "unknown",
      startedAt: new Date().toISOString(),
      pid: app.process()?.pid ?? null,
      routes: {}
    };
    const inspect = async (routeName, hash, selector) => {
      await page.evaluate((nextHash) => { window.location.hash = nextHash; }, hash);
      await page.locator(selector).waitFor({ state: "visible", timeout: 15_000 });
      const geometry = await page.evaluate(() => {
        const content = document.querySelector(".workspace-content");
        const pageNode = document.querySelector(".workspace-page");
        const heading = pageNode?.querySelector("h2");
        const rect = heading?.getBoundingClientRect();
        return {
          content: content?.getBoundingClientRect().toJSON(),
          page: pageNode?.getBoundingClientRect().toJSON(),
          heading: rect?.toJSON(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          bodyScrollWidth: document.body.scrollWidth
        };
      });
      assert.ok(geometry.content?.width > 0 && geometry.content?.height > 0, `${routeName} content is empty`);
      assert.ok(geometry.page?.width > 0 && geometry.page?.height > 0, `${routeName} page is empty`);
      assert.ok(geometry.heading?.width > 0 && geometry.heading?.height > 0, `${routeName} heading is empty`);
      assert.ok(geometry.bodyScrollWidth <= geometry.viewport.width + 1, `${routeName} overflows horizontally`);
      const screenshot = path.join(outputDir, `${routeName}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
      evidence.routes[routeName] = { geometry, screenshot: path.basename(screenshot) };
    };

    await inspect("overview", "#overview", ".workspace-page--overview");
    await inspect("devices", "#devices", ".workspace-page--devices");
    await inspect("settings", "#settings/general", ".workspace-page--settings");

    await page.keyboard.press("/");
    await page.locator(".workspace-command").waitFor({ state: "visible", timeout: 2_000 });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".workspace-command").count(), 0, "Escape did not close the command palette");
    evidence.keyboardSearch = "PASS";

    const deviceId = process.env.DSC_RELEASE_ACCEPTANCE_DEVICE_ID;
    if (deviceId) {
      await inspect("device-detail", `#device/${encodeURIComponent(deviceId)}`, ".workspace-page--device");
      assert.equal(await page.locator(".workspace-device-facts").count(), 1, "installed Release detail must expose stable facts");
      assert.equal(await page.getByText(/宿主机 Agent\s*[:：]?\s*在线/).count(), 1, "installed Release VM detail must expose host Agent state");
      evidence.deviceDetail = "PASS";
    } else {
      evidence.deviceDetail = "NOT PROVEN: no release-runner device id was configured";
    }
    evidence.pageErrors = pageErrors;
    fs.writeFileSync(path.join(outputDir, `Windows-Release-Launch-Evidence-v${evidence.version}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    assert.deepEqual(pageErrors, [], `renderer page errors: ${pageErrors.join("; ")}`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
