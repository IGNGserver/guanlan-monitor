const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const outputDir = path.resolve(process.argv[3] ?? "artifacts/visual-regression");
fs.mkdirSync(outputDir, { recursive: true });
let activeBrowser = null;

async function fulfillJson(route, payload, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

const fixturePoint = (value, offsetMinutes = 0) => ({
  timestamp: new Date(Date.parse("2026-09-13T10:00:00.000Z") - offsetMinutes * 60_000).toISOString(),
  value
});

const fixtureDevices = [
  {
    deviceId: "workstation-01",
    hostname: "工作站 · 上海",
    os: "windows",
    agentVersion: "3.0.1",
    agentChannel: "test",
    status: "online",
    lastSeenAt: "2026-09-13T10:00:00.000Z",
    cpuUsagePercent: 6.6,
    gpuUsagePercent: 18,
    gpuMemoryUsagePercent: 42,
    memoryUsagePercent: 54,
    memoryUsedBytes: 17_300_000_000,
    memoryTotalBytes: 32_000_000_000,
    diskUsagePercent: 62,
    diskUsedBytes: 620_000_000_000,
    diskTotalBytes: 1_000_000_000_000,
    sortOrder: 0
  },
  {
    deviceId: "nas-01",
    hostname: "归档 NAS",
    os: "linux",
    agentVersion: "3.0.1",
    agentChannel: "test",
    status: "online",
    lastSeenAt: "2026-09-13T09:59:40.000Z",
    cpuUsagePercent: 78.4,
    gpuUsagePercent: null,
    gpuMemoryUsagePercent: null,
    memoryUsagePercent: 68,
    memoryUsedBytes: 43_500_000_000,
    memoryTotalBytes: 64_000_000_000,
    diskUsagePercent: 84,
    diskUsedBytes: 8_400_000_000_000,
    diskTotalBytes: 10_000_000_000_000,
    sortOrder: 1
  },
  {
    deviceId: "offline-01",
    hostname: "离线笔记本",
    os: "windows",
    agentVersion: null,
    agentChannel: null,
    status: "offline",
    lastSeenAt: "2026-09-12T19:42:00.000Z",
    cpuUsagePercent: null,
    gpuUsagePercent: null,
    gpuMemoryUsagePercent: null,
    memoryUsagePercent: null,
    diskUsagePercent: null,
    sortOrder: 2
  }
];

const overviewMetrics = {
  window: "5m",
  instances: fixtureDevices.map((device, index) => ({
    deviceId: device.deviceId,
    hostname: device.hostname,
    cpuUsagePercent: [fixturePoint(12 + index * 18, 5), fixturePoint(device.cpuUsagePercent ?? 0)],
    memoryUsedBytes: [fixturePoint((device.memoryUsedBytes ?? 0) * 0.96, 5), fixturePoint(device.memoryUsedBytes ?? 0)],
    diskUsedBytes: [fixturePoint((device.diskUsedBytes ?? 0) * 0.99, 5), fixturePoint(device.diskUsedBytes ?? 0)],
    networkRxBytesPerSec: [fixturePoint(2_400_000 + index * 800_000, 5), fixturePoint(3_100_000 + index * 500_000)],
    networkTxBytesPerSec: [fixturePoint(1_200_000 + index * 400_000, 5), fixturePoint(1_700_000 + index * 300_000)],
    unavailableMetrics: device.unavailableMetrics
  }))
};

function metricFixture(device) {
  const now = fixturePoint(0).timestamp;
  const points = (values) => values.map((value, index) => fixturePoint(value, (values.length - index - 1) * 2));
  const unavailable = device.unavailableMetrics ?? [];
  const latest = {
    system: { processCount: 247, threadCount: 1_982, handleCount: 8_420, uptimeSeconds: 321_456 },
    cpuUsagePercent: device.cpuUsagePercent ?? 0,
    cpuFrequencyMHz: 4_200,
    cpuTemperatureC: 52,
    cpuPackages: [{ id: "cpu-0", name: "AMD Ryzen 7", model: "AMD Ryzen 7", coreCount: 8, logicalCount: 16, l3CacheBytes: 32_000_000, frequencyMHz: 4_200, usagePercent: device.cpuUsagePercent ?? 0, temperatureC: 52 }],
    memoryUsedBytes: device.memoryUsedBytes ?? 0,
    memoryTotalBytes: device.memoryTotalBytes ?? 0,
    memoryAvailableBytes: Math.max(0, (device.memoryTotalBytes ?? 0) - (device.memoryUsedBytes ?? 0)),
    memoryCachedBytes: 2_000_000_000,
    memoryCommittedBytes: device.memoryUsedBytes ?? 0,
    memoryCommitLimitBytes: device.memoryTotalBytes ?? 0,
    memorySpeedMHz: 5_600,
    memorySlotCount: 2,
    memoryFormFactor: "DIMM",
    swapUsedBytes: 100_000_000,
    swapTotalBytes: 8_000_000_000,
    diskUsedBytes: device.diskUsedBytes ?? 0,
    diskTotalBytes: device.diskTotalBytes ?? 0,
    networkRxBytesPerSec: 3_100_000,
    networkTxBytesPerSec: 1_700_000,
    disks: [{ id: "disk-0", name: "系统盘", mountPoint: "/", filesystem: "ext4", totalBytes: device.diskTotalBytes ?? 1_000_000_000_000, usedBytes: device.diskUsedBytes ?? 0, activePercent: 12, temperatureC: 39, healthStatus: "良好" }],
    networkInterfaces: [{ id: "eth0", name: "以太网", model: "10 GbE", ipv4: ["192.168.5.24"], rxBytesPerSec: 3_100_000, txBytesPerSec: 1_700_000, totalRxBytes: 12_000_000_000, totalTxBytes: 4_000_000_000, linkSpeedMbps: 1_000 }],
    gpus: [{ id: "gpu-0", name: "集成显卡", utilizationPercent: 18, encodeUtilizationPercent: 2, decodeUtilizationPercent: 4, frequencyMHz: 1_200, integrated: true, memoryKind: "shared", memoryUsedBytes: 2_000_000_000, memoryTotalBytes: 8_000_000_000, temperatureC: 48, driverVersion: "31.0" }],
    temperatureSensors: [{ id: "temp-0", source: "acpi", rawName: "Package", displayName: "CPU 封装", role: "cpu_package", currentC: 52, status: "valid", confidence: "direct" }],
    sensorBackends: [{ id: "builtin", label: "内置采集", ok: true }],
    fans: [{ id: "fan-0", label: "系统风扇", interface: "hwmon", rpm: 860, controlMode: "auto" }],
    unavailableMetrics: unavailable
  };
  return {
    device: { ...device, platform: device.os, arch: "x64", cpuModel: "AMD Ryzen 7" },
    status: device.status,
    lastSeenAt: device.lastSeenAt,
    window: "5m",
    rangeStart: new Date(Date.parse(now) - 5 * 60_000).toISOString(),
    rangeEnd: now,
    enabledMetrics: ["cpuUsage", "cpuFrequency", "cpuTemperature", "memoryUsage", "diskUsage", "diskRead", "diskWrite", "networkRxRate", "networkTxRate", "gpuUsage", "gpuMemory", "gpuTemperature", "fanRpm", "temperatureSources"],
    enabledDeviceIds: {},
    instanceMetricConfig: {},
    availableMetrics: [],
    latest,
    series: {
      cpuUsagePercent: points([device.cpuUsagePercent ?? 0, device.cpuUsagePercent ?? 0, device.cpuUsagePercent ?? 0]),
      cpuFrequencyMHz: points([3_900, 4_100, 4_200]),
      cpuTemperatureC: points([48, 50, 52]),
      gpuUsagePercent: points([10, 14, 18]),
      gpuEncodePercent: points([1, 2, 2]),
      gpuDecodePercent: points([2, 3, 4]),
      gpuFrequencyMHz: points([1_000, 1_100, 1_200]),
      gpuMemoryUsagePercent: points([35, 40, 42]),
      gpuMemoryUsedBytes: points([1_500_000_000, 1_800_000_000, 2_000_000_000]),
      gpuTemperatureC: points([44, 46, 48]),
      memoryUsagePercent: points([48, 52, device.memoryUsagePercent ?? 0]),
      swapUsagePercent: points([1, 1, 2]),
      memoryUsedBytes: points([(device.memoryUsedBytes ?? 0) * 0.9, (device.memoryUsedBytes ?? 0) * 0.95, device.memoryUsedBytes ?? 0]),
      swapUsedBytes: points([50_000_000, 70_000_000, 100_000_000]),
      memoryAvailableBytes: points([12_000_000_000, 11_000_000_000, latest.memoryAvailableBytes]),
      memoryCachedBytes: points([1_800_000_000, 1_900_000_000, latest.memoryCachedBytes]),
      memoryCommittedBytes: points([latest.memoryCommittedBytes * 0.9, latest.memoryCommittedBytes * 0.95, latest.memoryCommittedBytes]),
      memoryCommitLimitBytes: points([latest.memoryCommitLimitBytes, latest.memoryCommitLimitBytes, latest.memoryCommitLimitBytes]),
      systemProcessCount: points([220, 234, 247]),
      systemThreadCount: points([1_800, 1_900, 1_982]),
      systemHandleCount: points([7_900, 8_100, 8_420]),
      diskUsagePercent: points([58, 60, device.diskUsagePercent ?? 0]),
      diskUsedBytes: points([(device.diskUsedBytes ?? 0) * 0.98, (device.diskUsedBytes ?? 0) * 0.99, device.diskUsedBytes ?? 0]),
      diskReadBytesPerSec: points([800_000, 1_200_000, 1_600_000]),
      diskWriteBytesPerSec: points([400_000, 600_000, 900_000]),
      networkRxBytesPerSec: points([2_000_000, 2_600_000, 3_100_000]),
      networkTxBytesPerSec: points([800_000, 1_200_000, 1_700_000]),
      trafficRxBytes: points([10_000_000_000, 11_000_000_000, 12_000_000_000]),
      trafficTxBytes: points([3_000_000_000, 3_500_000_000, 4_000_000_000]),
      cpus: [{ id: "cpu-0", name: "AMD Ryzen 7", usagePercent: points([40, 55, device.cpuUsagePercent ?? 0]), frequencyMHz: points([3_900, 4_100, 4_200]), temperatureC: points([48, 50, 52]) }],
      disks: [{ id: "disk-0", name: "系统盘", mountPoint: "/", totalBytes: points([latest.diskTotalBytes, latest.diskTotalBytes, latest.diskTotalBytes]), usagePercent: points([58, 60, device.diskUsagePercent ?? 0]), activePercent: points([10, 15, 12]), usedBytes: points([latest.diskUsedBytes * .98, latest.diskUsedBytes * .99, latest.diskUsedBytes]), readBytesPerSec: points([800_000, 1_200_000, 1_600_000]), writeBytesPerSec: points([400_000, 600_000, 900_000]), temperatureC: points([37, 38, 39]) }],
      networks: [{ id: "eth0", name: "以太网", rxBytesPerSec: points([2_000_000, 2_600_000, 3_100_000]), txBytesPerSec: points([800_000, 1_200_000, 1_700_000]), trafficRxBytes: points([10_000_000_000, 11_000_000_000, 12_000_000_000]), trafficTxBytes: points([3_000_000_000, 3_500_000_000, 4_000_000_000]) }],
      gpus: [],
      fans: [{ id: "fan-0", name: "系统风扇", interface: "hwmon", rpm: points([700, 820, 860]) }],
      temperatureSensors: [{ id: "temp-0", name: "CPU 封装", rawName: "Package", source: "acpi", role: "cpu_package", confidence: "direct", status: "valid", currentC: points([48, 50, 52]) }]
    }
  };
}

// Resolves a Carbon token to a computed rgb() string so assertions can compare
// against the live theme instead of a hardcoded colour. Carbon's --cds-* tokens
// only exist inside the themed wrapper, so the probe has to live there too.
const RESOLVE_TOKENS = `(() => {
  const scope = document.querySelector(".guanlan-carbon-theme") ?? document.body;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = "var(--cds-layer-selected-01)";
  scope.append(probe);
  const selectedLayer = getComputedStyle(probe).color;
  probe.style.color = "var(--workspace-color-primary-container)";
  const m3PrimaryContainer = getComputedStyle(probe).color;
  probe.remove();
  return { selectedLayer, m3PrimaryContainer };
})()`;

// The five shell contracts that regressed in v3.0.106. Every value is measured,
// not inferred from a class name, so a future layer cannot silently re-add an
// outer box or a second drawer.
const UI_CONTRACT = `(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const clickable = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const sidebar = document.querySelector(".workspace-sidebar");
  const root = document.querySelector(".workspace-root");
  return {
    sidebar: {
      open: Boolean(root?.classList.contains("is-sidebar-open")),
      offCanvas: sidebar ? Math.round(sidebar.getBoundingClientRect().right) <= 0 : null,
      width: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      labelWidths: [...document.querySelectorAll(".workspace-sidebar .workspace-nav-item span")].map((s) => Math.round(s.getBoundingClientRect().width)),
      collapseButton: clickable(document.querySelector(".workspace-sidebar__collapse")),
      topbarToggle: clickable(document.querySelector(".workspace-topbar__toggle"))
    },
    topbar: box(document.querySelector(".workspace-topbar")),
    heading: box(document.querySelector(".workspace-page-intro h2")),
    segmented: [...document.querySelectorAll(".m3-segmented-control")].map((el) => {
      const s = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      return {
        name: el.getAttribute("aria-label") ?? "",
        height: Math.round(rect.height),
        scrollsHorizontally: el.scrollWidth > el.clientWidth + 1,
        scrollsVertically: el.scrollHeight > el.clientHeight + 1,
        rightWithinParent: parent ? rect.right <= parent.right + 1 : true,
        borderWidth: s.borderTopWidth,
        paddingTop: s.paddingTop,
        background: s.backgroundColor,
        overflow: s.overflowX + "/" + s.overflowY
      };
    }),
    chips: [...document.querySelectorAll(".m3-chip")].map((el) => {
      const s = getComputedStyle(el);
      return { selected: el.classList.contains("is-selected"), height: Math.round(el.getBoundingClientRect().height), background: s.backgroundColor, borderWidth: s.borderTopWidth };
    }),
    summary: (() => {
      const grid = document.querySelector(".workspace-overview-summary");
      if (!grid) return null;
      return {
        grid: box(grid),
        items: [...grid.children].map((item) => ({
          box: box(item),
          rowTops: [...item.children].map((child) => Math.round(child.getBoundingClientRect().top)),
          paddingLeft: getComputedStyle(item).paddingLeft,
          paddingRight: getComputedStyle(item).paddingRight
        }))
      };
    })(),
    toolbar: (() => {
      const bar = document.querySelector(".workspace-directory-toolbar");
      if (!bar) return null;
      return { box: box(bar), childHeights: [...bar.children].map((el) => Math.round(el.getBoundingClientRect().height)) };
    })(),
    deviceContext: (() => {
      const ctx = document.querySelector(".workspace-device-context");
      return ctx ? box(ctx) : null;
    })()
  };
})()`;

async function run() {
  const browser = await chromium.launch({ headless: true });
  activeBrowser = browser;
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const consoleMessages = [];
  const failedRequests = [];
  const requestLog = [];
  let fixtureMode = "live";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "unknown" }));
  page.on("request", (request) => {
    if (["PUT", "POST", "DELETE"].includes(request.method())) {
      let payload = null;
      try { payload = request.postDataJSON(); } catch { /* non-JSON mutations are still recorded */ }
      requestLog.push({ method: request.method(), url: request.url(), payload });
    }
  });

  /* The fixture is intercepted per page, not per browser. Anything that opens a
     second page has to install the same routes on it, or `/api/auth/session`
     reaches the real dev server, answers 401, and the console renders the login
     form instead of the workspace. */
  const installFixtureRoutes = async (target) => {
    await target.route("**/socket.io/**", (route) => route.abort());
    await target.route("**/api/**", async (route) => {
      const requestUrl = new URL(route.request().url());
      const pathname = requestUrl.pathname;
      if (fixtureMode === "unauthorized") return fulfillJson(route, { error: "unauthorized" }, 401);
      if (fixtureMode === "login" && pathname === "/api/auth/session") return fulfillJson(route, { error: "unauthorized" }, 401);
      if (pathname === "/api/auth/session") return fulfillJson(route, { ok: true, issuedAt: "2026-08-21T00:00:00.000Z" });
      if (pathname === "/api/instances") return fulfillJson(route, fixtureMode === "empty" ? [] : fixtureDevices);
      if (pathname === "/api/overview/metrics") return fulfillJson(route, fixtureMode === "empty" ? { ...overviewMetrics, instances: [] } : overviewMetrics);
      if (/^\/api\/devices\/[^/]+\/metrics$/.test(pathname)) {
        const deviceId = decodeURIComponent(pathname.split("/")[3]);
        return fulfillJson(route, metricFixture(fixtureDevices.find((device) => device.deviceId === deviceId) ?? fixtureDevices[0]));
      }
      if (pathname === "/api/devices/reorder") return fulfillJson(route, { ok: true });
      if (/^\/api\/devices\/[^/]+\/traffic-calendar$/.test(pathname)) return fulfillJson(route, null);
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
  };
  await installFixtureRoutes(page);

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
  if (!desktopMetrics) {
    const diagnostics = {
      url: page.url(),
      bodyText: await page.locator("body").innerText().catch(() => ""),
      bodyHtml: await page.locator("body").innerHTML().catch(() => ""),
      pageErrors,
      consoleMessages,
      failedRequests
    };
    fs.writeFileSync(path.join(outputDir, "web-visual-regression-diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
    console.error(JSON.stringify(diagnostics, null, 2));
  }
  assert.ok(desktopMetrics, "shared workspace shell is missing");
  assert.equal(desktopMetrics.display, "grid");
  assert.equal(desktopMetrics.sidebarDisplay, "flex");
  assert.ok(desktopMetrics.sidebarWidth > 0);
  assert.ok(desktopMetrics.mainWidth > 0);
  assert.ok(desktopMetrics.bodyScrollWidth <= desktopMetrics.viewportWidth + 1, "desktop shell overflows horizontally");
  assert.equal(await page.locator(".workspace-device-item").count(), 0, "primary navigation must not contain a device list");
  assert.deepEqual((await page.locator(".workspace-sidebar .m3-navigation-item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "设置"], "sidebar contains destinations only");
  assert.equal(await page.getByRole("button", { name: "中枢状态" }).count(), 0, "the retired hub destination must not come back");
  assert.equal(await page.locator(".workspace-hub-card").count(), 1, "the overview must own the hub connection facts");
  const overviewHealthTotal = await page.locator(".workspace-overview-summary__item").first().locator("strong").innerText();
  assert.equal(overviewHealthTotal, String(fixtureDevices.length), "overview health must include every registered device");
  // "需要关注" is only defensible if the tile says what it adds up.
  const attentionTile = page.locator(".workspace-overview-summary__item").nth(2);
  assert.equal((await attentionTile.locator("span").first().innerText()).trim(), "需要关注", "the attention tile must be labelled by what it counts");
  const attentionComposition = (await attentionTile.locator("small").innerText()).trim();
  assert.match(attentionComposition, /\d+ 台设备离线/, "the attention tile must expose its composition");
  // One state, one word. The tile used to count "未响应" devices while the
  // directory tagged those same machines "离线", which reads as two different
  // kinds of trouble; the aggregate now borrows the directory's word.
  assert.doesNotMatch(attentionComposition, /未响应/, "the overview must not invent a second name for an offline device");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  const deviceTable = page.locator(".workspace-directory-surface .cds--data-table");
  const deviceRows = deviceTable.locator("tbody tr");
  assert.equal(await deviceRows.count(), fixtureDevices.length, "Carbon device table must render every fixture device");

  // Assert Carbon DataTable headers and body cells stay aligned.
  const headerColumns = await deviceTable.locator("thead th").allTextContents();
  assert.deepEqual(headerColumns.map((col) => col.trim()), ["状态", "设备", "CPU 使用率", "内存使用", "磁盘使用", "最后在线", "操作"], "directory table header must contain exactly 7 columns in order");
  assert.equal(await deviceTable.locator("thead th").count(), 7, "directory table must have 7 column headers");
  assert.equal(await deviceRows.first().locator("td").count(), 7, "Carbon device table rows must expose the same 7 columns");
  // One state, one word, on the page that lists the states.
  assert.doesNotMatch(await deviceTable.innerText(), /未响应/, "the directory must not invent a second name for an offline device");
  assert.equal(await deviceTable.getByText("离线", { exact: true }).count(), 1, "an unreachable device is tagged 离线 in the directory");
  // The hub answers with 78.4; the table used to print `78.4%` while the chart of
  // the same metric said `78%`, so the two disagreed on one screen.
  assert.equal((await deviceRows.nth(1).locator("td").nth(2).innerText()).trim(), "78%", "directory percentages must round like the charts");
  const deviceSearch = page.getByLabel("搜索设备", { exact: true });
  await deviceSearch.fill("工作站");
  assert.equal(await deviceRows.count(), 1, "device search must filter the full directory");
  // An empty *result* and an empty *fleet* are different facts. A filter that
  // matches nothing used to render "没有匹配设备" and "还没有设备接入" together,
  // sending the reader to the hub connection when the search box was the answer.
  await deviceSearch.fill("绝对不存在的设备名");
  assert.equal(await deviceRows.count(), 0, "a filter with no match must empty the table");
  const filteredOutStates = page.locator(".workspace-page--devices .workspace-empty");
  assert.equal(await filteredOutStates.count(), 1, "a filtered-out directory must offer exactly one explanation");
  assert.equal((await filteredOutStates.locator("h3").innerText()).trim(), "没有匹配设备", "a filtered-out directory must blame the filter, not the hub");
  assert.match((await filteredOutStates.locator("p").innerText()).trim(), /3 台已接入设备/, "the empty result must name the population the filter was applied to");
  await deviceSearch.fill("");
  await page.screenshot({ path: path.join(outputDir, "web-devices-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#settings/appearance`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
  // The browser console and the desktop client must offer the same section names;
  // only 本机 Agent is allowed to differ, and that is the desktop's own run.
  assert.deepEqual(
    (await page.locator(".workspace-sidebar__nav .workspace-nav-item span").allTextContents()).map((label) => label.trim()),
    ["通用", "外观", "连接", "数据与更新", "快捷键参考", "关于观澜"],
    "web settings must use the shared section vocabulary"
  );
  assert.equal(await page.locator(".workspace-page--settings h2").innerText(), "外观", "the settings heading must name the open section");
  await page.screenshot({ path: path.join(outputDir, "web-settings-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#device/${encodeURIComponent("workstation-01")}`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".workspace-breadcrumb").getByText("设备", { exact: true }).count(), 1, "device detail must expose a device breadcrumb");
  assert.equal(await page.locator(".workspace-device-facts").count(), 1, "device detail must expose stable facts");
  // 设备详情页现在完全由 DEVICE_DASHBOARD 常量驱动，选项卡集合本身就是布局契约。
  // 用 .cds--tabs 限定范围：同一个上下文条里还有时间范围的 ContentSwitcher，它同样
  // 暴露 role="tab"，不限定会连它一起数进来。
  const deviceTabs = page.locator(".workspace-device-context .cds--tabs");
  assert.deepEqual(
    (await deviceTabs.getByRole("tab").allTextContents()).map((label) => label.trim()),
    ["概览", "处理器与内存", "存储与网络", "显卡与散热"],
    "device detail must render exactly the four fixed layout tabs in order"
  );

  await page.getByRole("tab", { name: "处理器与内存" }).click();
  assert.equal(await page.getByRole("tab", { name: "处理器与内存" }).getAttribute("aria-selected"), "true", "device tabs must change the active panel");
  // 切换选项卡必须整体换掉分区，上一个选项卡的图表不能残留在页面上。
  assert.equal(await page.locator(".dashboard-section#section-compute").count(), 1, "compute tab must render its fixed sections");
  assert.equal(await page.locator(".dashboard-section#section-overview").count(), 0, "switching tabs must unmount the previous tab's sections");
  assert.ok((await page.locator(".dashboard-section .chart-tile").count()) > 0, "fixed sections must render Carbon chart tiles");

  // 换选项卡时页眉与吸顶设备条必须一动不动，否则整页内容会上下跳一下。
  const tabHeaderHeights = {};
  for (const tabName of ["处理器与内存", "存储与网络", "显卡与散热", "概览"]) {
    await page.getByRole("tab", { name: tabName }).click();
    await page.waitForTimeout(220);
    tabHeaderHeights[tabName] = await page.evaluate(() => {
      const box = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
      const context = document.querySelector(".workspace-device-context");
      return {
        topbar: box(document.querySelector(".workspace-topbar")),
        headingTop: Math.round(document.querySelector(".workspace-page-intro h2")?.getBoundingClientRect().top ?? 0),
        context: box(context),
        tabs: box(context?.querySelector(".cds--tabs")),
        controls: box(context?.querySelector(".workspace-device-context__controls"))
      };
    });
  }
  for (const [tabName, measured] of Object.entries(tabHeaderHeights)) {
    // The caption copy differs per tab, so only the caption-independent parts of
    // the header must be identical; the strip may differ by a single line.
    const { context, ...fixed } = measured;
    assert.deepEqual(fixed, (({ topbar, headingTop, tabs, controls }) => ({ topbar, headingTop, tabs, controls }))(tabHeaderHeights["处理器与内存"]), `switching to the "${tabName}" tab must not move the header (saw ${JSON.stringify(measured)})`);
    assert.ok(Math.abs(context - tabHeaderHeights["处理器与内存"].context) <= 20, `switching to the "${tabName}" tab moved the sticky device context by more than one caption line (${context} vs ${tabHeaderHeights["处理器与内存"].context})`);
  }

  // 小组件机制已经彻底移除：设备页不得再出现排布编辑入口，也不得再写布局接口。
  assert.equal(await page.getByRole("button", { name: "编辑排布" }).count(), 0, "widget layout editing must be gone from the device page");
  assert.equal(await page.getByRole("button", { name: "添加小组件" }).count(), 0, "widget drawer entry must be gone from the device page");
  assert.equal(await page.locator(".workspace-widget-drawer, .workspace-dynamic-empty").count(), 0, "widget drawer and empty-canvas hints must not render");
  assert.equal(requestLog.filter((request) => request.url.includes("/api/widget-layouts")).length, 0, "device page must not write the widget layout API");

  const oneHourRange = page.locator(".workspace-range-control button", { hasText: "1 小时" });
  await oneHourRange.click();
  await page.waitForTimeout(150);
  assert.equal(await oneHourRange.getAttribute("aria-selected"), "true", "switching the metric window must mark the new range as active");

  await page.getByRole("tab", { name: "概览" }).click();
  await page.waitForTimeout(300);
  // 固定布局的磁贴必须撑满自己声明的栅格跨度。曾经 Carbon css-grid 的行规则
  // 没有产出，行退化成块级盒子被压进一条隐式轨道，磁贴塌缩成标题的宽度；
  // 这里把几何记进报告的同时直接断言，防止同类塌缩悄悄回来。
  const deviceChartGeometry = await page.evaluate(() => {
    const box = (el) => {
      const rect = el.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x) };
    };
    const style = (el, props) => {
      const computed = getComputedStyle(el);
      const out = {};
      for (const prop of props) out[prop] = computed.getPropertyValue(prop);
      return out;
    };
    const cells = [...document.querySelectorAll(".dashboard-section .dashboard-cell")].slice(0, 4);
    return {
      cells: cells.map((cell) => {
        const tile = cell.querySelector(".chart-tile");
        const body = tile ? tile.querySelector(".chart-tile__body") : null;
        const holder = body ? body.firstElementChild : null;
        return {
          className: cell.className,
          // 计算样式收进 css 子对象：它把宽度序列化成 "541px" 字符串，和 box 的
          // 数字宽度同名平铺会互相覆盖，断言就会拿字符串去比数字。
          cell: { ...box(cell), css: style(cell, ["display", "grid-column", "min-width"]) },
          grid: cell.parentElement ? { className: cell.parentElement.className, ...box(cell.parentElement), css: style(cell.parentElement, ["display", "grid-template-columns"]) } : null,
          tile: tile ? { ...box(tile), css: style(tile, ["display", "width"]) } : null,
          body: body ? { ...box(body), css: style(body, ["display", "width", "min-width"]) } : null,
          holder: holder ? { className: holder.className, ...box(holder), css: style(holder, ["display", "width", "height"]) } : null
        };
      })
    };
  });
  assert.ok(deviceChartGeometry.cells.length > 0, "overview section must render chart cells");
  for (const cell of deviceChartGeometry.cells) {
    assert.ok(cell.grid && cell.grid.css.display === "grid", "chart cells must sit in a CSS grid");
    assert.ok(cell.grid.width > 600, "fixed layout grid must span the content column");
    // half 跨度在 1440px 下约占栅格的一半；任何小于四分之一的宽度都说明塌缩。
    assert.ok(cell.cell.width > cell.grid.width * 0.25, `chart cell collapsed to ${cell.cell.width}px of a ${cell.grid.width}px grid`);
    assert.ok(
      cell.tile && Number.isFinite(cell.tile.width) && cell.tile.width >= cell.cell.width - 2,
      `chart tile must fill its cell (tile ${cell.tile?.width}px, cell ${cell.cell.width}px)`
    );
  }
  await page.screenshot({ path: path.join(outputDir, "web-device-desktop.png"), fullPage: true, animations: "disabled" });
  await page.goto(`${baseUrl}#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "管理顺序" }).click();
  // Management mode exposes each row action directly: a menu that has to be
  // discovered before it can be used was the whole cost of the old flow.
  const firstRow = deviceRows.first();
  await firstRow.getByRole("button", { name: "删除" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "请确认操作" });
  await deleteDialog.waitFor({ state: "visible", timeout: 2_000 });
  assert.equal(await deleteDialog.count(), 1, "device deletion must require confirmation");
  assert.equal(await deleteDialog.getByRole("heading", { name: /删除/ }).count(), 1, "delete dialog must expose a destructive heading");
  await deleteDialog.getByRole("button", { name: "取消" }).click();
  await firstRow.getByRole("button", { name: "下移" }).click();
  assert.equal(await page.getByRole("button", { name: "保存顺序" }).isEnabled(), true, "device order must stay a draft until save");
  assert.equal(await firstRow.getByRole("button", { name: "上移" }).isDisabled(), true, "the first row cannot move further up");

  // Assert leave guard: when order is modified and user clicks navigation destination, confirm dialog must trigger
  let dialogMessage = null;
  let dialogDismissed = false;
  const dismissDialog = async (dialog) => {
    dialogMessage = dialog.message();
    dialogDismissed = true;
    await dialog.dismiss();
  };
  page.once("dialog", dismissDialog);
  await page.locator(".workspace-sidebar .m3-navigation-item").filter({ hasText: "总览" }).click();
  await page.waitForTimeout(200);
  assert.ok(dialogDismissed, "navigating away with dirty device order must prompt confirmation");
  assert.match(dialogMessage ?? "", /设备顺序修改尚未保存/, "confirm message must warn about device order draft");
  // Since dismissed, we must still remain on #devices page
  assert.match(page.url(), /#devices$/, "cancelling leave guard must keep the current page");

  await page.getByRole("button", { name: "取消" }).click();
  assert.equal(await page.getByRole("button", { name: "管理顺序" }).count(), 1, "device order cancel must restore browsing mode");

  await page.goto(`${baseUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
  const searchTrigger = page.locator(".workspace-search-trigger");
  await searchTrigger.focus();
  await page.keyboard.press("/");
  await page.locator(".workspace-command").waitFor({ state: "visible", timeout: 2_000 });
  await page.keyboard.press("Escape");
  await page.locator(".workspace-command").waitFor({ state: "detached", timeout: 2_000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains("workspace-search-trigger"), null, { timeout: 2_000 });
  assert.equal(await page.locator(".workspace-command").count(), 0, "Escape must close command palette");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("workspace-search-trigger")), true, "command palette must restore focus to its trigger");

  await page.keyboard.press("/");
  const commandInput = page.locator(".workspace-command input");
  await commandInput.fill("工作站");
  await page.locator(".workspace-command__item").filter({ hasText: "工作站" }).click();
  await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);

  // Assert 390px search button contains .m3-button__icon and accessible name is "查找设备、页面或设置"
  const mobileSearchTrigger = page.locator(".workspace-topbar .workspace-search-trigger");
  assert.equal(await mobileSearchTrigger.count(), 1, "390px topbar must have search trigger");
  assert.equal(await mobileSearchTrigger.getAttribute("aria-label"), "查找设备、页面或设置", "search trigger accessible name must be '查找设备、页面或设置'");
  assert.equal(await mobileSearchTrigger.locator(".m3-button__icon").isVisible(), true, "390px search trigger icon must be visible");
  assert.equal(await mobileSearchTrigger.locator(".m3-button__label").isVisible(), false, "390px search trigger text label must be hidden");

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
  assert.deepEqual((await page.locator(".workspace-bottom-nav__item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "设置"], "compact destinations must match the rail one-for-one");
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("刷新", { exact: true }).count(), 0, "compact navigation must not contain refresh");
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("搜索", { exact: true }).count(), 0, "compact navigation must not contain search");
  assert.ok(mobileMetrics.rootWidth > 0);
  assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "mobile shell overflows horizontally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-mobile.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#settings/appearance`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-settings-mobile-nav").waitFor({ state: "visible", timeout: 2_000 });
  assert.equal(await page.locator(".workspace-settings-mobile-nav").getByRole("button", { name: "返回控制台" }).count(), 1, "compact settings must expose a back action");
  assert.ok(await page.locator(".workspace-settings-mobile-nav__list button").count() >= 2, "compact settings must expose category navigation");
  // The drawer is never shown on arrival, but the topbar must always be able to
  // open it, and an open drawer must carry its labels. It used to be impossible:
  // the toggle was hidden below 600px and a one-time migration overwrote the
  // stored rail preference.
  await page.evaluate(() => localStorage.setItem("dsc-sidebar-collapsed", "false"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".workspace-settings-mobile-nav").waitFor({ state: "visible", timeout: 2_000 });
  assert.equal(await page.locator(".workspace-root").evaluate((node) => node.classList.contains("is-sidebar-collapsed")), true, "a compact viewport must not open the drawer over the content on arrival");
  assert.equal(await page.evaluate(() => localStorage.getItem("dsc-sidebar-collapsed")), "false", "closing the drawer on arrival must not rewrite the stored rail preference");
  // Assert on "rendered and hittable", not on a specific display value: Carbon
  // owns the icon button's own display and it has changed before.
  const toggleGeometry = await page.evaluate(() => {
    const node = document.querySelector(".workspace-topbar__toggle");
    if (!node) return null;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { display: style.display, visibility: style.visibility, width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  assert.ok(toggleGeometry && toggleGeometry.display !== "none" && toggleGeometry.visibility !== "hidden" && toggleGeometry.width >= 24 && toggleGeometry.height >= 24, `the topbar must keep a hittable sidebar toggle while the sidebar is a drawer (${JSON.stringify(toggleGeometry)})`);
  await page.locator(".workspace-topbar__toggle").click();
  await page.waitForTimeout(320);
  const drawerEvidence = await page.evaluate(() => {
    const sidebar = document.querySelector(".workspace-sidebar");
    const rect = sidebar?.getBoundingClientRect();
    return {
      open: document.querySelector(".workspace-root")?.classList.contains("is-sidebar-open") ?? false,
      left: Math.round(rect?.left ?? -999),
      width: Math.round(rect?.width ?? 0),
      labelWidths: [...document.querySelectorAll(".workspace-sidebar .workspace-nav-item span")].map((node) => Math.round(node.getBoundingClientRect().width))
    };
  });
  assert.ok(drawerEvidence.open, "the topbar toggle must open the sidebar drawer at 390px");
  assert.ok(drawerEvidence.left >= 0 && drawerEvidence.width > 200, `the drawer must sit on canvas (left ${drawerEvidence.left}, width ${drawerEvidence.width})`);
  assert.ok(drawerEvidence.labelWidths.length > 0 && drawerEvidence.labelWidths.every((label) => label > 16), `the open drawer must show its labels (${drawerEvidence.labelWidths.join(",")})`);
  await page.screenshot({ path: path.join(outputDir, "web-drawer-open-mobile.png"), animations: "disabled" });
  // Leaving drawer mode restores the stored preference.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".workspace-root").evaluate((node) => node.classList.contains("is-sidebar-open")), true, "widening past the drawer breakpoint must restore the stored expanded rail preference");
  const inlineRail = await page.evaluate(() => [...document.querySelectorAll(".workspace-sidebar .workspace-nav-item span")].map((node) => Math.round(node.getBoundingClientRect().width)));
  assert.ok(inlineRail.length > 0 && inlineRail.every((label) => label > 16), `an expanded sidebar must show its labels between 840 and 1199px (${inlineRail.join(",")})`);
  // Leave the run in the expanded state so the breakpoint matrix exercises the
  // labelled rail rather than the collapsed one.
  await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });

  const stateEvidence = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  fixtureMode = "login";
  // Hash-only navigation keeps UnifiedConsole mounted, so auth state would not
  // be rechecked after changing the fixture. Add a query marker for each state
  // transition to force a fresh document and exercise the real session gate.
  await page.goto(`${baseUrl}?visual-state=login#overview`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "进入设备状态中枢" }).waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator("#access-key").count(), 1, "anonymous state must expose the login form field");
  assert.equal(await page.getByRole("button", { name: "登录" }).count(), 1, "anonymous state must expose login action");
  await page.screenshot({ path: path.join(outputDir, "web-state-login.png"), fullPage: true, animations: "disabled" });
  stateEvidence.push({ state: "login", screenshot: "web-state-login.png" });

  fixtureMode = "empty";
  await page.goto(`${baseUrl}?visual-state=empty#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.getByText("还没有可用设备", { exact: true }).count(), 1, "empty fixture must explain the next action");
  // The first-run guide is the answer to "where does the key come from" and
  // "what makes a device appear"; it must show while the fleet is empty.
  assert.equal(await page.locator(".workspace-onboarding").count(), 1, "an empty fleet must offer the first-run guide");
  assert.equal(await page.locator(".workspace-onboarding__steps > li").count(), 3, "the guide must list every step");
  await page.locator(".workspace-onboarding").getByRole("button", { name: "不再显示" }).click();
  assert.equal(await page.locator(".workspace-onboarding").count(), 0, "dismissing the guide must be honoured immediately");
  assert.equal(await page.evaluate(() => localStorage.getItem("dsc-onboarding-dismissed")), "true", "the dismissal must persist");
  // With nothing connected, the directory may only say so once. It used to answer
  // "没有匹配设备 · 尝试清空搜索或调整状态筛选" and "还没有设备接入" at the same time.
  await page.goto(`${baseUrl}?visual-state=empty#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  const emptyFleetStates = page.locator(".workspace-page--devices .workspace-empty");
  assert.equal(await emptyFleetStates.count(), 1, "an unconnected hub must offer exactly one empty state");
  assert.equal((await emptyFleetStates.locator("h3").innerText()).trim(), "还没有设备接入", "an empty fleet must say the hub has no devices, not that the filter failed");
  await page.goto(`${baseUrl}?visual-state=empty#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: path.join(outputDir, "web-state-empty.png"), fullPage: true, animations: "disabled" });
  stateEvidence.push({ state: "empty", screenshot: "web-state-empty.png" });

  fixtureMode = "live";
  await page.goto(`${baseUrl}?visual-state=live#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
  fixtureMode = "unauthorized";
  await page.getByTitle("刷新状态").click();
  await page.locator(".workspace-session-recovery").waitFor({ state: "visible", timeout: 5_000 });
  assert.notEqual((await page.locator(".workspace-topbar .workspace-status-label").innerText()).trim(), "在线", "401 must not remain live");
  await page.screenshot({ path: path.join(outputDir, "web-state-session-expired.png"), fullPage: true, animations: "disabled" });
  stateEvidence.push({ state: "session-expired", screenshot: "web-state-session-expired.png" });
  fixtureMode = "live";
  await page.getByRole("button", { name: "重新检查" }).click();
  await page.locator(".workspace-session-recovery").waitFor({ state: "hidden", timeout: 5_000 });
  assert.equal((await page.locator(".workspace-topbar .workspace-status-label").innerText()).trim(), "在线", "re-authenticated refresh must restore live state");

  const matrix = [];
  // Header band height per viewport, and the sticky device context per route, so
  // "the header floats when I change page or tab" cannot come back.
  const headerHeights = new Map();
  const contextHeights = new Map();
  const uiContracts = [];
  const matrixRoutes = [
    ["overview", ".workspace-page--overview"],
    ["devices", ".workspace-page--devices"],
    ["device-detail", `.workspace-page--device`],
    ["settings", ".workspace-page--settings"]
  ];
  for (const [round, theme] of [[1, "light"], [2, "dark"]]) {
    await page.evaluate((nextTheme) => localStorage.setItem("dsc-theme", nextTheme), theme);
    // The provider reads the persisted theme during mount. Navigate to a fresh
    // overview document once per round so the current route from the previous
    // round (which ends on settings at 390px) cannot hide the overview gate.
    await page.goto(`${baseUrl}?visual-round=${round}#overview`, { waitUntil: "domcontentloaded" });
    await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
    for (const [width, height] of [[1440, 900], [1024, 768], [840, 900], [820, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      // Crossing the drawer breakpoint animates the sidebar, and a hash-only
      // navigation does not outlast that transition. Measure once it settles.
      await page.waitForFunction(() => {
        const node = document.querySelector(".workspace-sidebar");
        if (!node) return true;
        const rect = node.getBoundingClientRect();
        const key = `${Math.round(rect.left)}:${Math.round(rect.width)}`;
        const previous = window.__dscSettledRect;
        window.__dscSettledRect = key;
        return previous === key;
      }, null, { timeout: 5_000, polling: 120 }).catch(() => undefined);
      for (const [name, selector] of matrixRoutes) {
        const hash = name === "overview" ? "overview" : name === "devices" ? "devices" : name === "device-detail" ? `device/${encodeURIComponent("workstation-01")}` : "settings/appearance";
        await page.goto(`${baseUrl}#${hash}`, { waitUntil: "domcontentloaded" });
        await page.locator(selector).waitFor({ state: "visible", timeout: 15_000 });
        const geometry = await page.evaluate(() => {
          const root = document.querySelector(".workspace-root");
          const sidebar = document.querySelector(".workspace-sidebar");
          const main = document.querySelector(".workspace-main");
          const content = document.querySelector(".workspace-content");
          const pageNode = document.querySelector(".workspace-page");
          const heading = pageNode?.querySelector("h2");
          const rect = heading?.getBoundingClientRect();
          const rootStyle = root ? getComputedStyle(root) : null;
          return {
            root: root?.getBoundingClientRect().toJSON(),
            sidebar: sidebar?.getBoundingClientRect().toJSON(),
            main: main?.getBoundingClientRect().toJSON(),
            gridTemplateRows: rootStyle?.gridTemplateRows ?? "",
            gridTemplateColumns: rootStyle?.gridTemplateColumns ?? "",
            content: content?.getBoundingClientRect().toJSON(),
            page: pageNode?.getBoundingClientRect().toJSON(),
            heading: rect?.toJSON(),
            bodyScrollWidth: document.body.scrollWidth,
            viewportWidth: window.innerWidth
          };
        });
        assert.ok(geometry?.content?.width > 0 && geometry?.content?.height > 0, `${name} content is empty at ${width}px`);
        assert.ok(geometry?.page?.width > 0 && geometry?.page?.height > 0, `${name} page is empty at ${width}px`);
        assert.ok(geometry?.heading?.width > 0 && geometry?.heading?.height > 0 && geometry.heading.bottom > 0 && geometry.heading.top < height, `${name} heading is outside viewport at ${width}px`);
        assert.ok(geometry.bodyScrollWidth <= width + 1, `${name} overflows horizontally at ${width}px`);

        // ---- shell contracts (sidebar drawer, header band, option rows) ----
        const contract = await page.evaluate(UI_CONTRACT);
        const tokens = await page.evaluate(RESOLVE_TOKENS);
        const at = (label) => `${name} ${label} at ${width}px/${theme}`;

        // 1. The sidebar must be able to show its labels at every width.
        assert.ok(contract.sidebar.topbarToggle || contract.sidebar.collapseButton, at("has no way to open the sidebar"));
        if (width <= 839) {
          // Drawer mode: the rail is always full width, so labels render even
          // while the drawer is parked off canvas.
          assert.ok(contract.sidebar.topbarToggle, at("the drawer needs a topbar toggle on a compact viewport"));
          if (contract.sidebar.open) {
            assert.ok(!contract.sidebar.offCanvas, at("an open drawer is still off canvas"));
            assert.ok(contract.sidebar.labelWidths.every((label) => label > 16), at(`the open drawer hides its labels (${contract.sidebar.labelWidths.join(",")})`));
          } else {
            assert.equal(contract.sidebar.offCanvas, true, at("a closed drawer must sit off canvas rather than over the content"));
          }
        } else {
          assert.ok(contract.sidebar.collapseButton, at("the inline sidebar needs its own collapse toggle"));
          if (contract.sidebar.open) {
            assert.ok(contract.sidebar.width >= 200, at(`an expanded sidebar collapsed to ${contract.sidebar.width}px`));
            assert.ok(contract.sidebar.labelWidths.length > 0 && contract.sidebar.labelWidths.every((label) => label > 16), at(`an expanded sidebar hides its labels (${contract.sidebar.labelWidths.join(",")})`));
          } else {
            assert.ok(contract.sidebar.labelWidths.every((label) => label === 0), at("a collapsed sidebar must not render labels"));
          }
        }

        // 2. The header is a fixed band: same height on every route at a width.
        assert.ok(contract.topbar && contract.topbar.h > 0, at("the header is missing"));
        headerHeights.set(width, new Set([...(headerHeights.get(width) ?? []), contract.topbar.h]));

        // 3. Horizontally arranged options must not carry an outer box, and must
        //    not be a scroll container. Only an overflow of auto/scroll can draw
        //    the scrollbar that was reported, so that is the contract; the
        //    switcher's own skewed ::after legitimately inks past its box.
        for (const control of contract.segmented) {
          assert.equal(control.borderWidth, "0px", at(`segmented control "${control.name}" still has an outer border`));
          assert.equal(control.paddingTop, "0px", at(`segmented control "${control.name}" still has outer padding`));
          assert.equal(control.background, "rgba(0, 0, 0, 0)", at(`segmented control "${control.name}" still has an outer fill`));
          assert.equal(control.overflow, "visible/visible", at(`segmented control "${control.name}" is still a scroll container (${control.overflow})`));
          assert.ok(control.rightWithinParent, at(`segmented control "${control.name}" overflows its container`));
        }
        for (const chip of contract.chips) {
          if (chip.selected) {
            assert.notEqual(chip.background, tokens.m3PrimaryContainer, at("a selected chip still uses the Material primary container fill"));
            assert.notEqual(chip.background, "rgba(0, 0, 0, 0)", at("a selected chip must read as selected"));
          }
        }

        // 4. The four overview tiles share one row contract. Tiles are compared
        //    inside their own visual row: below 1199px the strip is two by two.
        if (contract.summary) {
          const tiles = contract.summary.items;
          assert.equal(tiles.length, 4, at("the overview summary must hold four tiles"));
          const rows = new Map();
          for (const tile of tiles) {
            const key = tile.box.y;
            rows.set(key, [...(rows.get(key) ?? []), tile]);
          }
          for (const group of rows.values()) {
            if (group.length < 2) continue;
            for (const [rowIndex, label] of ["label", "value", "note"].entries()) {
              const tops = group.map((tile) => tile.rowTops[rowIndex]).filter((top) => Number.isFinite(top));
              if (tops.length >= 2) {
                const spread = Math.max(...tops) - Math.min(...tops);
                assert.ok(spread <= 2, at(`${label} row is off by ${spread}px between tiles in the same row`));
              }
            }
          }
        }

        // 5. The devices toolbar keeps one control height per row.
        if (contract.toolbar) {
          const heights = contract.toolbar.childHeights.filter((h) => h > 0);
          assert.ok(heights.length >= 2, at("the directory toolbar lost its controls"));
          const spread = Math.max(...heights) - Math.min(...heights);
          assert.ok(spread <= 16, at(`directory toolbar controls differ by ${spread}px (${heights.join("/")})`));
        }
        if (contract.deviceContext) {
          contextHeights.set(`${width}:${name}`, contract.deviceContext.h);
        }
        uiContracts.push({ round, theme, width, name, contract, tokens });

        const segmentedControls = await page.locator(".m3-segmented-control").evaluateAll((controls) => {
          const luminance = (color) => {
            const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
            if (!channels || channels.length !== 3) return null;
            const linear = channels.map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
          };
          return controls.map((control) => {
            const selected = control.querySelector('[role="tab"][aria-selected="true"]');
            const label = selected?.querySelector(".cds--content-switcher__label");
            const foreground = selected ? getComputedStyle(selected).color : "";
            const background = selected ? getComputedStyle(selected, "::after").backgroundColor : "";
            const labelStyle = label ? getComputedStyle(label) : null;
            const labelBounds = label?.getBoundingClientRect();
            const alphaMatch = background.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
            const backgroundAlpha = alphaMatch ? Number(alphaMatch[1]) : 1;
            const foregroundLuminance = luminance(foreground);
            const backgroundLuminance = luminance(background);
            const contrast = foregroundLuminance == null || backgroundLuminance == null
              ? null
              : (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
            return {
              name: control.getAttribute("aria-label") ?? "",
              label: label?.textContent?.trim() ?? "",
              labelVisible: Boolean(label && labelStyle?.display !== "none" && labelStyle?.visibility !== "hidden" && labelBounds?.width > 0 && labelBounds?.height > 0),
              foreground,
              background,
              backgroundAlpha,
              contrast
            };
          });
        });
        for (const segment of segmentedControls) {
          assert.ok(segment.label && segment.labelVisible, `${name} has a segmented control without visible selected text at ${width}px (${segment.name})`);
          assert.equal(segment.backgroundAlpha, 1, `${name} selected segment fill is transparent at ${width}px (${segment.name})`);
          assert.ok(segment.contrast >= 4.5, `${name} selected segment text contrast is ${segment.contrast?.toFixed(2) ?? "unknown"} at ${width}px (${segment.name}: ${segment.foreground} on ${segment.background})`);
        }
        let mobileDirectory = null;
        if (width <= 839 && name === "devices") {
          mobileDirectory = await page.evaluate(() => {
            const scrollViewport = document.querySelector(".workspace-directory-table-scroll");
            const table = scrollViewport?.querySelector(".cds--data-table");
            const hint = document.querySelector(".workspace-directory-scroll-hint");
            const hintBounds = hint?.getBoundingClientRect();
            const hintStyle = hint ? getComputedStyle(hint) : null;
            const sortBounds = document.querySelector(".workspace-directory-toolbar__sort")?.getBoundingClientRect();
            const actionsBounds = document.querySelector(".workspace-directory-toolbar__actions")?.getBoundingClientRect();
            return {
              scrollViewportClientWidth: scrollViewport?.clientWidth ?? 0,
              scrollViewportWidth: scrollViewport?.scrollWidth ?? 0,
              tableWidth: table?.getBoundingClientRect().width ?? 0,
              hintVisible: Boolean(hint && hintStyle?.display !== "none" && hintStyle?.visibility !== "hidden" && hintBounds?.width > 0 && hintBounds?.height > 0),
              sortWidth: sortBounds?.width ?? 0,
              actionsWidth: actionsBounds?.width ?? 0,
              sortTop: sortBounds?.top ?? null,
              sortBottom: sortBounds?.bottom ?? null,
              actionsTop: actionsBounds?.top ?? null,
              actionsBottom: actionsBounds?.bottom ?? null
            };
          });
          assert.ok(mobileDirectory.scrollViewportClientWidth > 0, `devices table scroll viewport is missing at ${width}px`);
          assert.ok(mobileDirectory.tableWidth >= 1076, `devices table was compressed below its readable width at ${width}px (${mobileDirectory.tableWidth}px)`);
          assert.ok(mobileDirectory.scrollViewportWidth > mobileDirectory.scrollViewportClientWidth, `devices table does not scroll inside its viewport at ${width}px (scroll ${mobileDirectory.scrollViewportWidth}px, viewport ${mobileDirectory.scrollViewportClientWidth}px)`);
          assert.ok(mobileDirectory.hintVisible, `devices table scroll hint is not visible at ${width}px`);
          assert.ok(mobileDirectory.sortWidth > 0 && mobileDirectory.actionsWidth > 0, `devices sort or management control is missing at ${width}px`);
          if (width === 390) {
            assert.ok(Math.abs(mobileDirectory.sortTop - mobileDirectory.actionsTop) < 2, "mobile sort and management controls must share a row at 390px");
            assert.ok(mobileDirectory.sortBottom > mobileDirectory.sortTop && mobileDirectory.actionsBottom > mobileDirectory.actionsTop, "mobile sort and management controls must remain visible at 390px");
          }
        }
        if (round === 1 && name === "overview" && [840, 1024, 1440].includes(width)) {
          assert.ok(geometry.root?.width >= width - 1 && geometry.root?.height >= height - 1, `Web root geometry is incomplete at ${width}px`);
          assert.ok(geometry.sidebar?.width > 0 && geometry.sidebar?.height >= height - 1, `Web sidebar geometry is incomplete at ${width}px`);
          assert.ok(geometry.main?.width > 0 && geometry.main?.height >= height - 1, `Web main geometry is incomplete at ${width}px`);
          assert.ok(geometry.main?.x > geometry.sidebar?.x + geometry.sidebar?.width - 1, `Web columns collapse at ${width}px`);
          assert.match(geometry.gridTemplateRows, /\d+(?:\.\d+)?px|auto|minmax/, `Web grid rows are missing at ${width}px`);
        }
        const screenshotPath = path.join(outputDir, `matrix-round-${round}-${theme}-${width}-${name}.png`);
        // The route-specific screenshots above retain full-page evidence. The 40-cell
        // matrix deliberately samples the viewport so the runner cannot spend minutes
        // rasterizing the same long telemetry surface at every breakpoint.
        await page.screenshot({ path: screenshotPath, fullPage: false, animations: "disabled", timeout: 15_000 });
        matrix.push({ round, theme, width, name, screenshot: path.basename(screenshotPath), sha256: crypto.createHash("sha256").update(fs.readFileSync(screenshotPath)).digest("hex"), geometry, segmentedControls, mobileDirectory });
      }
    }
  }
  const overviewHashes = new Set(matrix.filter((item) => item.width === 1440 && item.name === "overview").map((item) => item.sha256));
  const routeHashes = new Set(matrix.filter((item) => item.round === 1 && item.width === 1440).map((item) => item.sha256));
  assert.equal(overviewHashes.size, 2, "the two visual rounds must produce separate theme evidence");
  assert.ok(routeHashes.size >= 3, "route screenshots must not collapse into one identical image");

  for (const [width, heights] of headerHeights) {
    assert.equal(heights.size, 1, `the header band must keep one height at ${width}px across routes (saw ${[...heights].join("/")})`);
  }
  for (const [key, height] of contextHeights) {
    assert.ok(height > 0 && height <= 320, `the sticky device context is ${height}px on ${key}`);
  }

  /* Touch-target contract.
   *
   * Every 44px rule in this UI lives behind `@media (pointer: coarse)`, and the
   * whole reason that kept breaking is specificity, not intent: a `(0,2,0)`
   * composite declaration in the first stylesheet layer silently outranked the
   * `(0,1,0)` coarse rule, so a phone got 30x30 icon buttons and 40px rows while
   * every desktop screenshot looked perfect. No assertion in this file could see
   * it, because none of them ran with a coarse pointer.
   *
   * This pass opens a *second* page with `hasTouch` so `(pointer: coarse)`
   * actually matches, walks every route, and fails on any interactive element
   * under 44px on either axis. Exceptions are listed explicitly and by class so
   * an addition has to be a deliberate decision.
   */
  const touchExempt = [
    // Carbon's chart legend draws its series toggle as a small colour swatch;
    // the label beside it is the reachable part and the markup is not ours.
    ".checkbox"
  ];
  const touchPage = await browser.newPage({
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true
  });
  const touchViolations = [];
  try {
    fixtureMode = "live";
    await installFixtureRoutes(touchPage);
    for (const routeHash of ["#overview", "#devices", `#device/${encodeURIComponent("workstation-01")}`, "#settings/general"]) {
      await touchPage.goto(`${baseUrl}?visual-state=live${routeHash}`, { waitUntil: "domcontentloaded" });
      const root = touchPage.locator(".workspace-root");
      await root.waitFor({ state: "visible", timeout: 15_000 }).catch(async () => {
        throw new Error(`the touch pass never reached the workspace at ${routeHash}; the page rendered ${await touchPage.locator("main, form, .workspace-login-shell").first().evaluate((node) => node.className).catch(() => "nothing")}`);
      });
      const coarse = await touchPage.evaluate(() => matchMedia("(pointer: coarse)").matches);
      assert.ok(coarse, `(pointer: coarse) must match on a touch page (${routeHash})`);
      const small = await touchPage.evaluate((exempt) => {
        /* Measure the area a thumb actually hits, not the graphic.
         *
         * Carbon draws a toggle as a 20px pill and a checkbox as a small box
         * inside a label row. Requiring 44px of the *graphic* would push the
         * stylesheet to distort the control, so the CSS deliberately leaves
         * those alone — what has to clear 44px is the label or row that carries
         * the pointer target. Walking up to the nearest such wrapper and taking
         * the larger box asks the question a user actually asks.
         */
        const HIT_AREA = 'label, [class*="--checkbox-label"], [class*="--toggle__wrapper"], .m3-switch-row, .m3-checkbox, .workspace-setting-row, .workspace-check-row, .cds--data-table tr';
        const rows = [];
        for (const el of document.querySelectorAll('button, a[href], input, select, [role="button"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"]')) {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
          if (rect.width < 1 || rect.height < 1) continue;
          if (rect.width >= 44 && rect.height >= 44) continue;
          if (exempt.some((selector) => el.matches(selector))) continue;
          if (el.closest("[hidden]") || el.getAttribute("aria-hidden") === "true") continue;
          let hitWidth = rect.width;
          let hitHeight = rect.height;
          const wrapper = el.closest(HIT_AREA);
          if (wrapper) {
            const box = wrapper.getBoundingClientRect();
            hitWidth = Math.max(hitWidth, box.width);
            hitHeight = Math.max(hitHeight, box.height);
          }
          if (hitWidth >= 44 && hitHeight >= 44) continue;
          const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : el.tagName.toLowerCase();
          rows.push({ cls, w: Math.round(rect.width), h: Math.round(rect.height), hitW: Math.round(hitWidth), hitH: Math.round(hitHeight), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24) });
        }
        const seen = new Map();
        for (const row of rows) seen.set(`${row.cls} ${row.w}x${row.h}`, row);
        return [...seen.values()];
      }, touchExempt);
      for (const row of small) touchViolations.push({ route: routeHash, ...row });
    }
    /* The drawer, open. Every sidebar control is `visibility: hidden` at phone
       widths until the drawer is pulled out, so a pass that only samples the
       closed state cannot see the support link or the nav rows — which is
       exactly where a `(0,2,0)` `min-height` in the first layer used to survive
       the coarse contract. */
    await touchPage.goto(`${baseUrl}?visual-state=live#overview`, { waitUntil: "domcontentloaded" });
    await touchPage.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
    await touchPage.locator(".workspace-topbar__toggle").click();
    await touchPage.locator(".workspace-root.is-sidebar-open .workspace-sidebar").waitFor({ state: "visible", timeout: 5_000 });
    const drawerSmall = await touchPage.evaluate((exempt) => {
      const rows = [];
      for (const el of document.querySelectorAll(".workspace-sidebar button, .workspace-sidebar a[href]")) {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || rect.width < 1 || rect.height < 1) continue;
        if (rect.width >= 44 && rect.height >= 44) continue;
        if (exempt.some((selector) => el.matches(selector))) continue;
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : el.tagName.toLowerCase();
        rows.push({ cls, w: Math.round(rect.width), h: Math.round(rect.height), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24) });
      }
      const seen = new Map();
      for (const row of rows) seen.set(`${row.cls} ${row.w}x${row.h}`, row);
      return [...seen.values()];
    }, touchExempt);
    for (const row of drawerSmall) touchViolations.push({ route: "drawer-open", ...row });
  } finally {
    await touchPage.close();
    fixtureMode = "live";
  }
  assert.deepEqual(touchViolations, [], `coarse-pointer targets below 44px: ${JSON.stringify(touchViolations)}`);

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
  const report = { baseUrl, fixtureDevices: fixtureDevices.length, desktopMetrics, mobileMetrics, deviceChartGeometry, headerHeights: Object.fromEntries(headerHeights), stateEvidence, touchExempt, uiContracts, matrix, requestLog, screenshots: fs.readdirSync(outputDir).sort() };
  fs.writeFileSync(path.join(outputDir, "web-visual-regression-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  activeBrowser = null;
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  run().catch(async (error) => {
    await activeBrowser?.close().catch(() => {});
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { fixtureDevices, overviewMetrics, metricFixture, fulfillJson };
