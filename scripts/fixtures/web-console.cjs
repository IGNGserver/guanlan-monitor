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
    networkInterfaces: [{ id: "eth0", name: "以太网", model: "10 GbE", ipv4: ["192.0.2.24"], rxBytesPerSec: 3_100_000, txBytesPerSec: 1_700_000, totalRxBytes: 12_000_000_000, totalTxBytes: 4_000_000_000, linkSpeedMbps: 1_000 }],
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


module.exports = { fixtureDevices, overviewMetrics, metricFixture };
