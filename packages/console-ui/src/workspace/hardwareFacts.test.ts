import assert from "node:assert/strict";
import test from "node:test";
import type { MetricsLatest } from "@dsc/shared";
import { describeBattery, describeBatteryHealth, describeClusters, describeNetworkLink, describePower, describePowerSource, extraHardwareRows, formatLinkSpeed } from "./hardwareFacts.ts";

const observedAt = "2026-10-18T00:00:00Z";

function latest(overrides: Partial<MetricsLatest> = {}): MetricsLatest {
  return {
    system: { processCount: 1, threadCount: 1, handleCount: 1 },
    cpuUsagePercent: 0, cpuFrequencyMHz: null, cpuTemperatureC: null, cpuPackages: [],
    memoryUsedBytes: 0, memoryTotalBytes: 0, memoryAvailableBytes: 0, memoryCachedBytes: 0, memoryCommittedBytes: 0, memoryCommitLimitBytes: 0,
    memorySpeedMHz: null, memorySlotCount: null, memoryFormFactor: null,
    swapUsedBytes: 0, swapTotalBytes: 0, diskUsedBytes: 0, diskTotalBytes: 0, networkRxBytesPerSec: 0, networkTxBytesPerSec: 0,
    disks: [], storagePools: [], networkInterfaces: [], gpus: [], temperatureSensors: [], sensorBackends: [], fans: [],
    ...overrides
  };
}

test("a machine without the new sources gets no extra hardware rows", () => {
  assert.deepEqual(extraHardwareRows(latest()), []);
  assert.deepEqual(extraHardwareRows(undefined), []);
});

test("Apple silicon facts are described in the hardware table", () => {
  const rows = extraHardwareRows(latest({
    cpuPackages: [{ id: "cpu-0", name: "Apple M3 Pro", clusters: [{ name: "Performance", coreCount: 6, frequencyMHz: 3204 }, { name: "Efficiency", coreCount: 6, frequencyMHz: null }] }],
    memoryType: "LPDDR5", memoryFormFactor: "On-package", memoryCompressedBytes: 1.5 * 1024 ** 3, memoryPressureLevel: "warning",
    thermal: { observedAt, source: "notify", pressureLevel: "moderate" },
    power: { observedAt, source: "IOReport", systemWatts: 18.24, cpuWatts: 4.1, gpuWatts: 1.25, aneWatts: 0, externalPower: true, adapterRatedWatts: 96 },
    battery: { observedAt, source: "IOPS", chargePercent: 80.4, charging: true, timeRemainingMinutes: 75, netPowerWatts: 30, healthPercent: 91.6, cycleCount: 312, temperatureC: 30.55, condition: "Good" }
  }));
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.label, row.value])), {
    "CPU 集群": "性能核 6 核 · 3.20 GHz / 能效核 6 核",
    "内存规格": "LPDDR5 · 统一内存（封装内）",
    "压缩内存": "1.5 GB",
    "内存压力": "偏高",
    "热压力": "中等",
    "供电": "外接电源 · 适配器 96 W",
    "功耗": "整机 18.2 W · CPU 4.1 W · GPU 1.3 W · 神经网络引擎 0.0 W",
    "电池": "80% · 充电中 · 充满还需 1 小时 15 分 · 充入 30.0 W",
    "电池健康": "最大容量 92% · 循环 312 次 · 30.6 °C · 状态良好"
  });
});

test("descriptions stay silent without data and do not invent states", () => {
  assert.equal(describePower({ observedAt, source: "x" }), null);
  assert.equal(describePowerSource(null, null), null);
  assert.equal(describePowerSource(null, { observedAt, source: "x", externalPower: false }), "电池供电");
  assert.equal(describeBattery({ observedAt, source: "x", chargePercent: 50, charging: false, externalPower: false, timeRemainingMinutes: 245, netPowerWatts: -12.45 }), "50% · 放电中 · 剩余 4 小时 5 分 · 放出 12.4 W");
  assert.equal(describeBattery({ observedAt, source: "x", chargePercent: 100, fullyCharged: true, charging: false, externalPower: true }), "100% · 已充满");
  assert.equal(describeBatteryHealth({ observedAt, source: "x", condition: "Service Recommended" }), "建议维修");
  assert.equal(describeClusters([]), null);
});

test("network link descriptions", () => {
  assert.equal(formatLinkSpeed(10000), "10 Gbps");
  assert.equal(formatLinkSpeed(2500), "2.5 Gbps");
  assert.equal(formatLinkSpeed(866.7), "866.7 Mbps");
  assert.equal(describeNetworkLink({ connectionType: "Ethernet", linkSpeedMbps: 1000 }), "以太网 · 1 Gbps");
  assert.equal(describeNetworkLink({ connectionType: "Wi-Fi", linkSpeedMbps: 866.7, signalStrengthPercent: 78, rssiDbm: -61 }), "Wi-Fi · 866.7 Mbps · 信号 78%（-61 dBm）");
  assert.equal(describeNetworkLink({ connectionType: null, linkSpeedMbps: null, signalStrengthPercent: null }), null);
  assert.equal(describeNetworkLink(undefined), null);
});
