const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { fixtureDevices, overviewMetrics, metricFixture } = require("./fixtures/web-console.cjs");

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const output = path.resolve(process.argv[3] ?? "artifacts/live-view");
fs.mkdirSync(output, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(() => localStorage.setItem("dsc-web-layout", "desktop"));
    let connected = true;
    let dockerDenied = true;
    let calls = 0;
    let resets = 0;
    let conflictAt = null;
    const topics = [];
    await context.route("**/socket.io/**", (route) => route.abort());
    await context.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let status = 200, body = {};
      if (pathname.includes("/live")) {
        calls++;
        const topic = pathname.split("/")[5];
        if (topic === "reset" && route.request().method() === "POST") { resets++; conflictAt = null; body = { ok: true }; }
        else if (!topic) body = { state: connected ? "ready" : "disconnected", sessionId: connected ? "fixture-session" : null, capabilities: ["metrics", "processes", "docker"], connectedAt: new Date().toISOString(), identityConflictAt: connected ? null : conflictAt };
        else if (!connected) { status = 503; body = { error: "device_not_connected" }; }
        else {
          topics.push(topic);
          let data;
          if (topic === "metrics") data = { observedAt: new Date().toISOString(), cpuPercent: 12.5, memoryUsedBytes: 2048, memoryTotalBytes: 4096, diskReadBytesPerSec: 100, diskWriteBytesPerSec: null, networkRxBytesPerSec: 300, networkTxBytesPerSec: 400 };
          if (topic === "processes") data = { observedAt: new Date().toISOString(), cpuScale: "host", memoryKind: "rss", totalCount: 1, truncated: false, items: [{ id: "fixture:42:100", pid: 42, parentPid: 1, name: "fixture-process", startedAt: new Date().toISOString(), cpuPercent: null, memoryBytes: null, threads: null, status: null }] };
          if (topic === "docker" && dockerDenied) { status = 502; body = { error: "docker_permission_denied" }; }
          else {
            if (topic === "docker") data = { observedAt: new Date().toISOString(), engineId: "fixture-engine", totalCount: 0, truncated: false, items: [] };
            body = { deviceId: fixtureDevices[0].deviceId, sessionId: "fixture-session", requestId: `fixture-${calls}`, receivedAt: new Date().toISOString(), topic, data };
          }
        }
      } else if (pathname === "/api/auth/session") body = { ok: true, issuedAt: "fixture-viewer" };
      else if (pathname === "/api/instances") body = fixtureDevices;
      else if (pathname === "/api/overview/metrics") body = overviewMetrics;
      else if (pathname.endsWith("/metrics")) body = metricFixture(fixtureDevices[0]);
      else if (pathname.endsWith("/traffic-calendar")) body = null;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${baseUrl}#device/${fixtureDevices[0].deviceId}`, { waitUntil: "domcontentloaded" });
    const panel = page.locator(".workspace-live");
    await panel.waitFor({ timeout: 30000 });
    await page.getByText("最近上报状态", { exact: true }).waitFor();
    await page.getByText("与中枢链路", { exact: true }).waitFor();
    await page.waitForTimeout(1300);
    assert.equal(calls, 0, "collapsed panel must not request a device");
    await panel.locator(":scope > summary").click();
    await panel.locator(".workspace-live__metrics strong").first().waitFor();
    assert.ok(topics.includes("metrics"));
    await panel.getByRole("tab", { name: "进程", exact: true }).click();
    await panel.getByText("fixture-process", { exact: true }).waitFor();
    assert.equal(await panel.locator("tbody tr").first().locator("td").nth(2).innerText(), "—", "missing process CPU must not become zero");
    await panel.getByRole("tab", { name: "Docker", exact: true }).click();
    await panel.getByText(/没有读取 Docker 的权限/).waitFor();
    assert.equal(await panel.getByText(/本次查询确实没有容器/).count(), 0, "permission denial is not an empty engine");
    dockerDenied = false;
    await panel.getByText(/本次查询确实没有容器/).waitFor();
    connected = false;
    await panel.getByText(/设备没有可用的实时连接/).waitFor();
    assert.equal(await panel.locator("table").count(), 0, "disconnection must remove stale live rows");
    const deviceQueries = topics.length;
    await page.waitForTimeout(1300);
    assert.equal(topics.length, deviceQueries, "disconnected device must not receive a query");
    connected = true;
    await panel.getByText(/本次查询确实没有容器/).waitFor();
    assert.ok(topics.length > deviceQueries, "the view resumes querying once the channel is ready again");
    connected = false;
    await panel.getByText(/设备没有可用的实时连接/).waitFor();
    conflictAt = new Date().toISOString();
    const resetButton = panel.getByRole("button", { name: "重置实时凭据", exact: true });
    await resetButton.waitFor();
    assert.ok(await panel.getByText(/安装身份与已登记的不一致/).isVisible(), "a refused enrollment is explained");
    await page.screenshot({ path: path.join(output, "live-identity-conflict.png"), fullPage: true });
    page.once("dialog", (dialog) => dialog.accept());
    await resetButton.click();
    await panel.getByText(/已重置/).waitFor();
    assert.equal(resets, 1, "reset is sent once, after confirmation");
    await page.waitForTimeout(1500);
    assert.ok(await panel.getByText(/已重置/).isVisible(), "the confirmation outlives the cleared conflict");
    assert.equal(await resetButton.count(), 0, "the reset action disappears once the Hub no longer reports a conflict");
    await page.screenshot({ path: path.join(output, "live-disconnected.png"), fullPage: true });
    await panel.locator(":scope > summary").click();
    await page.waitForTimeout(500);
    const stopped = calls;
    await page.waitForTimeout(1600);
    assert.equal(calls, stopped, "collapsing the panel must release polling");
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ passed: true, calls, topics, checks: ["collapsed idle", "metrics", "process null semantics", "Docker denied vs empty", "disconnected refusal", "reconnect resumes", "identity conflict reset", "collapse cleanup"] }, null, 2));
    console.log("Live view regression: 8 checks passed");
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
