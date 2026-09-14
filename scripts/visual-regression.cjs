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
    sortOrder: 0,
    instanceType: "device"
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
    sortOrder: 1,
    instanceType: "device"
  },
  {
    deviceId: "vm:102",
    hostname: "构建虚拟机",
    os: "linux",
    agentVersion: "3.0.1",
    agentChannel: "test",
    status: "online",
    lastSeenAt: "2026-09-13T09:58:20.000Z",
    cpuUsagePercent: 91.2,
    gpuUsagePercent: null,
    gpuMemoryUsagePercent: null,
    memoryUsagePercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    diskUsagePercent: 71,
    diskUsedBytes: 710_000_000_000,
    diskTotalBytes: 1_000_000_000_000,
    sortOrder: 2,
    instanceType: "virtual_machine",
    hostName: "归档 NAS",
    virtualMachine: { vmId: "vm:102", platform: "proxmox", node: "pve-01", type: "qemu", powerState: "running", hostName: "归档 NAS" },
    unavailableMetrics: ["memoryUsage", "gpuUsage", "gpuMemory"]
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
    sortOrder: 3,
    instanceType: "device"
  }
];

const overviewMetrics = {
  window: "5m",
  instances: fixtureDevices.map((device, index) => ({
    deviceId: device.deviceId,
    hostname: device.hostname,
    instanceType: device.instanceType,
    cpuUsagePercent: [fixturePoint(index === 2 ? 91 : 12 + index * 18, 5), fixturePoint(device.cpuUsagePercent ?? 0)],
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
    gpus: device.instanceType === "virtual_machine" ? [] : [{ id: "gpu-0", name: "集成显卡", utilizationPercent: 18, encodeUtilizationPercent: 2, decodeUtilizationPercent: 4, frequencyMHz: 1_200, integrated: true, memoryKind: "shared", memoryUsedBytes: 2_000_000_000, memoryTotalBytes: 8_000_000_000, temperatureC: 48, driverVersion: "31.0" }],
    temperatureSensors: [{ id: "temp-0", source: "acpi", rawName: "Package", displayName: "CPU 封装", role: "cpu_package", currentC: 52, status: "valid", confidence: "direct" }],
    sensorBackends: [{ id: "builtin", label: "内置采集", ok: true }],
    fans: [{ id: "fan-0", label: "系统风扇", interface: "hwmon", rpm: 860, controlMode: "auto" }],
    virtualization: null,
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
      temperatureSensors: [{ id: "temp-0", name: "CPU 封装", rawName: "Package", source: "acpi", role: "cpu_package", confidence: "direct", status: "valid", currentC: points([48, 50, 52]) }],
      storagePools: []
    }
  };
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  activeBrowser = browser;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestLog = [];
  let fixtureMode = "live";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (["PUT", "POST", "DELETE"].includes(request.method())) {
      let payload = null;
      try { payload = request.postDataJSON(); } catch { /* non-JSON mutations are still recorded */ }
      requestLog.push({ method: request.method(), url: request.url(), payload });
    }
  });

  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
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
    if (pathname === "/api/widget-layouts" && route.request().method() === "GET") {
      const url = new URL(route.request().url());
      return fulfillJson(route, { scopeKey: url.searchParams.get("scopeKey"), templateKey: url.searchParams.get("templateKey"), instanceLayout: null, templates: [] });
    }
    if (pathname === "/api/widget-layouts" && route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() ?? {};
      return fulfillJson(route, { scopeKey: payload.scopeKey, templateKey: payload.templateKey, instanceLayout: payload.instanceLayout ?? null, templates: [] });
    }
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
  assert.equal(await page.locator(".workspace-device-item").count(), 0, "primary navigation must not contain a device list");
  assert.deepEqual((await page.locator(".workspace-sidebar .m3-navigation-item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "接入中枢", "设置"], "sidebar contains destinations only");
  const overviewHealthTotal = await page.locator(".workspace-overview-summary__item").first().locator("strong").innerText();
  assert.equal(overviewHealthTotal, String(fixtureDevices.length), "overview health must include VM and host instances globally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".workspace-directory-surface .workspace-device-row").count(), fixtureDevices.length);

  // 1. Assert 7-column header alignment and column names
  const headerColumns = await page.locator(".workspace-directory-head [role='columnheader']").allTextContents();
  assert.deepEqual(headerColumns.map((col) => col.trim()), ["状态", "设备", "CPU", "内存", "磁盘", "最近心跳", "操作"], "directory table header must contain exactly 7 columns in order");
  const columnCount = await page.locator(".workspace-directory-head [role='columnheader']").count();
  assert.equal(columnCount, 7, "directory header must have 7 column headers");

  // Verify alignment / grid structure of header vs row
  const headRowMetrics = await page.evaluate(() => {
    const head = document.querySelector(".workspace-directory-head");
    const row = document.querySelector(".workspace-device-row");
    if (!head || !row) return null;
    const headCols = head.querySelectorAll("[role='columnheader']");
    const rowMain = row.querySelector(".workspace-device-row__main");
    const rowAction = row.querySelector(".workspace-device-row__action");
    return {
      headColsCount: headCols.length,
      headHasAction: Boolean(head.querySelector("[data-directory-column='action']")),
      rowHasAction: Boolean(rowAction),
      rowMainColSpan: rowMain?.getAttribute("style") || getComputedStyle(rowMain).gridColumn
    };
  });
  assert.ok(headRowMetrics, "directory table header or rows not found");
  assert.equal(headRowMetrics.headColsCount, 7, "directory header must expose 7 columns");
  assert.equal(headRowMetrics.headHasAction, true, "directory header must include action column");
  assert.equal(headRowMetrics.rowHasAction, true, "directory row must include action column");
  const deviceSearch = page.getByLabel("搜索设备", { exact: true });
  await deviceSearch.fill("构建虚拟机");
  assert.equal(await page.locator(".workspace-directory-surface .workspace-device-row").count(), 1, "device search must filter the full directory");
  await deviceSearch.fill("");
  await page.getByRole("radio", { name: "虚拟机" }).click();
  assert.equal(await page.locator(".workspace-directory-surface .workspace-device-row").count(), 1, "device type filter must isolate VMs");
  await page.getByRole("radio", { name: "全部类型" }).click();
  await page.screenshot({ path: path.join(outputDir, "web-devices-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#settings/appearance`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: path.join(outputDir, "web-settings-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#device/${encodeURIComponent("vm:102")}`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".workspace-breadcrumb").getByText("设备", { exact: true }).count(), 1, "device detail must expose a device breadcrumb");
  assert.equal(await page.locator(".workspace-device-facts").count(), 1, "device detail must expose stable facts");
  assert.equal(await page.getByText(/宿主机 Agent\s*[:：]?\s*在线/).count(), 1, "VM detail must separate power state from host Agent state");
  await page.getByRole("tab", { name: "算力与内存" }).click();
  assert.equal(await page.getByRole("tab", { name: "算力与内存" }).getAttribute("aria-selected"), "true", "device tabs must change the active panel");

  // Create a custom panel to test empty custom panel boundaries
  await page.getByRole("button", { name: "编辑排布" }).click();
  await page.getByRole("button", { name: "面板管理" }).click();
  await page.locator(".workspace-panel-manager__field input").fill("空测试面板");
  await page.getByRole("button", { name: "新建" }).click();
  // Wait for panel creation and tab switch to settle
  await page.getByRole("tab", { name: "空测试面板" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(300);

  // Non-edit mode on empty custom panel: must NOT expose drawer open button, must show non-editable hint
  await page.getByRole("button", { name: "退出编辑" }).click();
  assert.equal(await page.getByRole("tab", { name: "空测试面板" }).getAttribute("aria-selected"), "true", "empty custom panel tab must be selected");
  assert.equal(await page.getByRole("button", { name: "打开小组件抽屉" }).count(), 0, "empty custom panel in browse mode must not expose open drawer button");
  assert.equal(await page.locator(".workspace-dynamic-empty").getByText("请先点击“编辑排布”，再添加小组件").count(), 1, "empty custom panel must show hint to enter edit mode");
  // Enter edit mode: must expose open drawer button
  await page.getByRole("button", { name: "编辑排布" }).click();
  assert.equal(await page.getByRole("button", { name: "打开小组件抽屉" }).count(), 1, "empty custom panel in edit mode must expose open drawer button");
  await page.getByRole("button", { name: "退出编辑" }).click();

  await page.getByRole("tab", { name: "算力与内存" }).click();
  await page.getByRole("radio", { name: "1 小时" }).click();
  assert.equal(await page.getByRole("button", { name: "添加小组件" }).count(), 0, "widget add action must be gated by edit mode");
  await page.getByRole("button", { name: "编辑排布" }).click();
  assert.equal(await page.getByRole("button", { name: "添加小组件" }).count(), 1, "widget add action must appear in explicit edit mode");
  await page.getByRole("button", { name: "添加小组件" }).click();
  await page.locator(".workspace-widget-drawer").waitFor({ state: "visible", timeout: 2_000 });
  const addDirectWidget = page.locator(".workspace-widget-drawer__item").filter({ hasText: "硬件与系统" }).getByRole("button", { name: "添加", exact: true });
  assert.equal(await addDirectWidget.count(), 1, "widget drawer must expose a directly addable fixture widget");
  await addDirectWidget.click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole("button", { name: "放弃修改" }).count(), 1, "widget edits must expose discard");
  assert.equal(await page.getByRole("button", { name: "保存布局" }).isEnabled(), true, "adding a widget must dirty the layout draft");
  await page.getByRole("button", { name: "关闭小组件抽屉" }).click();
  await page.getByRole("button", { name: "保存布局" }).click();
  await page.waitForTimeout(150);
  const widgetSave = requestLog.find((request) => request.method === "PUT" && request.url.includes("/api/widget-layouts"));
  assert.ok(widgetSave, "widget save must call the shared layout adapter");
  assert.equal(widgetSave.payload?.instanceLayout?.version, 4, "widget layout version 4 contract must be preserved");
  assert.match(widgetSave.payload?.scopeKey ?? "", /^device:vm:102:/, "widget scope key must remain device-scoped");
  assert.match(widgetSave.payload?.templateKey ?? "", /^device-type:virtual_machine:/, "widget template key must remain type-scoped");
  await page.getByRole("button", { name: "退出编辑" }).click();
  await page.getByRole("button", { name: "编辑排布" }).click();
  await page.getByRole("button", { name: "添加小组件" }).click();
  const secondDirectWidget = page.locator(".workspace-widget-drawer__item").filter({ hasText: "硬件与系统" }).getByRole("button", { name: "添加", exact: true });
  assert.equal(await secondDirectWidget.count(), 1, "widget drawer must keep the direct add action available");
  await secondDirectWidget.click();
  await page.getByRole("button", { name: "关闭小组件抽屉" }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.goto(`${baseUrl}#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("button", { name: "管理顺序" }).click();
  const firstMenu = page.locator(".workspace-device-row__menu summary").first();
  await firstMenu.click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  assert.equal(await page.getByRole("dialog", { name: /删除/ }).count(), 1, "device deletion must require confirmation");
  await page.getByRole("dialog", { name: /删除/ }).getByRole("button", { name: "取消" }).click();
  if (!(await page.getByRole("menuitem", { name: "下移" }).isVisible())) await firstMenu.click();
  await page.getByRole("menuitem", { name: "下移" }).click();
  assert.equal(await page.getByRole("button", { name: "保存顺序" }).isEnabled(), true, "device order must stay a draft until save");

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
  assert.equal(await page.locator(".workspace-command").count(), 0, "Escape must close command palette");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("workspace-search-trigger")), true, "command palette must restore focus to its trigger");

  await page.keyboard.press("/");
  const commandInput = page.locator(".workspace-command input");
  await commandInput.fill("构建虚拟机");
  await page.locator(".workspace-command__item").filter({ hasText: "构建虚拟机" }).click();
  await page.locator(".workspace-page--device").waitFor({ state: "visible", timeout: 15_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-root").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(300);

  // Assert 390px search button contains .m3-button__icon and accessible name is "搜索设备、页面或设置"
  const mobileSearchTrigger = page.locator(".workspace-topbar .workspace-search-trigger");
  assert.equal(await mobileSearchTrigger.count(), 1, "390px topbar must have search trigger");
  assert.equal(await mobileSearchTrigger.getAttribute("aria-label"), "搜索设备、页面或设置", "search trigger accessible name must be '搜索设备、页面或设置'");
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
  assert.deepEqual((await page.locator(".workspace-bottom-nav__item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "中枢", "设置"]);
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("刷新", { exact: true }).count(), 0, "compact navigation must not contain refresh");
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("搜索", { exact: true }).count(), 0, "compact navigation must not contain search");
  assert.ok(mobileMetrics.rootWidth > 0);
  assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "mobile shell overflows horizontally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-mobile.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#settings/appearance`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-settings-mobile-nav").waitFor({ state: "visible", timeout: 2_000 });
  assert.equal(await page.locator(".workspace-settings-mobile-nav").getByRole("button", { name: "返回控制台" }).count(), 1, "compact settings must expose a back action");
  assert.ok(await page.locator(".workspace-settings-mobile-nav__list button").count() >= 2, "compact settings must expose category navigation");
  await page.evaluate(() => {
    localStorage.setItem("dsc-sidebar-collapsed", "false");
    localStorage.removeItem("dsc-sidebar-compact-migrated-v3");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".workspace-settings-mobile-nav").waitFor({ state: "visible", timeout: 2_000 });
  assert.equal(await page.locator(".workspace-root").evaluate((node) => node.classList.contains("is-sidebar-collapsed")), true, "compact settings must migrate the legacy expanded sidebar preference");

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
  const matrixRoutes = [
    ["overview", ".workspace-page--overview"],
    ["devices", ".workspace-page--devices"],
    ["device-vm", `.workspace-page--device`],
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
      for (const [name, selector] of matrixRoutes) {
        const hash = name === "overview" ? "overview" : name === "devices" ? "devices" : name === "device-vm" ? `device/${encodeURIComponent("vm:102")}` : "settings/appearance";
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
        matrix.push({ round, theme, width, name, screenshot: path.basename(screenshotPath), sha256: crypto.createHash("sha256").update(fs.readFileSync(screenshotPath)).digest("hex"), geometry });
      }
    }
  }
  const overviewHashes = new Set(matrix.filter((item) => item.width === 1440 && item.name === "overview").map((item) => item.sha256));
  const routeHashes = new Set(matrix.filter((item) => item.round === 1 && item.width === 1440).map((item) => item.sha256));
  assert.equal(overviewHashes.size, 2, "the two visual rounds must produce separate theme evidence");
  assert.ok(routeHashes.size >= 3, "route screenshots must not collapse into one identical image");

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
  const report = { baseUrl, fixtureDevices: fixtureDevices.length, desktopMetrics, mobileMetrics, stateEvidence, matrix, requestLog, screenshots: fs.readdirSync(outputDir).sort() };
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
