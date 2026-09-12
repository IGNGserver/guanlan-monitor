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

const fixturePoint = (value, offsetMinutes = 0) => ({
  timestamp: new Date(Date.parse("2026-09-13T10:00:00.000Z") - offsetMinutes * 60_000).toISOString(),
  value
});

const fixtureDevices = [
  {
    deviceId: "workstation-01",
    hostname: "工作站 · 上海",
    os: "windows",
    agentVersion: "3.0.0",
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
    agentVersion: "3.0.0",
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
    agentVersion: "3.0.0",
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/socket.io/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/auth/session") return fulfillJson(route, { ok: true, issuedAt: "2026-08-21T00:00:00.000Z" });
    if (pathname === "/api/instances") return fulfillJson(route, fixtureDevices);
    if (pathname === "/api/overview/metrics") return fulfillJson(route, overviewMetrics);
    if (/^\/api\/devices\/[^/]+\/metrics$/.test(pathname)) {
      const deviceId = decodeURIComponent(pathname.split("/")[3]);
      return fulfillJson(route, metricFixture(fixtureDevices.find((device) => device.deviceId === deviceId) ?? fixtureDevices[0]));
    }
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
  await page.screenshot({ path: path.join(outputDir, "web-workspace-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#devices`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--devices").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".workspace-directory-surface .workspace-device-row").count(), fixtureDevices.length);
  await page.screenshot({ path: path.join(outputDir, "web-devices-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#settings/appearance`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--settings").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: path.join(outputDir, "web-settings-desktop.png"), fullPage: true, animations: "disabled" });

  await page.goto(`${baseUrl}#overview`, { waitUntil: "domcontentloaded" });
  await page.locator(".workspace-page--overview").waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("/");
  await page.locator(".workspace-command").waitFor({ state: "visible", timeout: 2_000 });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".workspace-command").count(), 0, "Escape must close command palette");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#overview`, { waitUntil: "domcontentloaded" });
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
  assert.equal(mobileMetrics.bottomNavDisplay, "grid");
  assert.deepEqual((await page.locator(".workspace-bottom-nav__item").allTextContents()).map((label) => label.trim()), ["总览", "设备", "中枢", "设置"]);
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("刷新", { exact: true }).count(), 0, "compact navigation must not contain refresh");
  assert.equal(await page.locator(".workspace-bottom-nav").getByText("搜索", { exact: true }).count(), 0, "compact navigation must not contain search");
  assert.ok(mobileMetrics.rootWidth > 0);
  assert.ok(mobileMetrics.bodyScrollWidth <= mobileMetrics.viewportWidth + 1, "mobile shell overflows horizontally");
  await page.screenshot({ path: path.join(outputDir, "web-workspace-mobile.png"), fullPage: true, animations: "disabled" });

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
  await browser.close();
  console.log(JSON.stringify({ baseUrl, fixtureDevices: fixtureDevices.length, desktopMetrics, mobileMetrics, screenshots: fs.readdirSync(outputDir).sort() }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
