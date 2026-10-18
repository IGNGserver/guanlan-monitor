import type { BatteryStats, CpuClusterStats, MemoryPressureLevel, MetricsLatest, NetworkInterfaceStats, PowerStats, ThermalPressureLevel } from "@dsc/shared";

/**
 * Plain-text descriptions of hardware facts that some platforms report and
 * others do not. Every function returns null (or omits a row) when the source
 * is absent, so a machine without a battery or power sensors shows nothing
 * instead of an empty "—" row.
 */

const CLUSTER_NAMES: Record<string, string> = { Performance: "性能核", Efficiency: "能效核" };

function watts(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)} W`;
}

function bytesSize(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let current = value;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${Number.isInteger(current) ? current : current.toFixed(1)} ${units[index]}`;
}

export function formatLinkSpeed(mbps: number): string {
  if (mbps >= 1000) {
    const gbps = mbps / 1000;
    return `${Number.isInteger(gbps) ? gbps : gbps.toFixed(1)} Gbps`;
  }
  return `${Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps`;
}

export function clusterLabel(name: string): string {
  return CLUSTER_NAMES[name] ?? name;
}

export function describeCluster(cluster: CpuClusterStats): string {
  const parts = [`${cluster.coreCount} 核`];
  if (cluster.frequencyMHz != null && Number.isFinite(cluster.frequencyMHz)) parts.push(`${(cluster.frequencyMHz / 1000).toFixed(2)} GHz`);
  return parts.join(" · ");
}

export function describeClusters(clusters: readonly CpuClusterStats[] | undefined): string | null {
  if (!clusters?.length) return null;
  return clusters.map((cluster) => `${clusterLabel(cluster.name)} ${describeCluster(cluster)}`).join(" / ");
}

export function describePower(power: PowerStats | null | undefined): string | null {
  if (!power) return null;
  const parts: string[] = [];
  const add = (label: string, value: number | undefined) => {
    if (value != null && Number.isFinite(value)) parts.push(`${label} ${watts(value)}`);
  };
  add("整机", power.systemWatts);
  add("输入", power.inputWatts);
  add("CPU", power.cpuWatts);
  add("GPU", power.gpuWatts);
  add("神经网络引擎", power.aneWatts);
  add("内存", power.dramWatts);
  add("媒体引擎", power.mediaWatts);
  return parts.length ? parts.join(" · ") : null;
}

export function describePowerSource(power: PowerStats | null | undefined, battery: BatteryStats | null | undefined): string | null {
  const external = power?.externalPower ?? battery?.externalPower;
  if (external == null) return null;
  if (!external) return "电池供电";
  // Adapter ratings are whole watts (61 W, 96 W); they are a rating, not a reading.
  return power?.adapterRatedWatts != null ? `外接电源 · 适配器 ${Math.round(power.adapterRatedWatts)} W` : "外接电源";
}

function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours} 小时 ${rest} 分` : `${rest} 分`;
}

export function describeBattery(battery: BatteryStats | null | undefined): string | null {
  if (!battery) return null;
  const parts: string[] = [];
  if (battery.chargePercent != null) parts.push(`${Math.round(battery.chargePercent)}%`);
  if (battery.fullyCharged) parts.push("已充满");
  else if (battery.charging) parts.push("充电中");
  else if (battery.charging === false && battery.externalPower === false) parts.push("放电中");
  if (battery.timeRemainingMinutes != null) parts.push(`${battery.charging ? "充满还需" : "剩余"} ${duration(battery.timeRemainingMinutes)}`);
  if (battery.netPowerWatts != null && Math.abs(battery.netPowerWatts) >= 0.05) parts.push(`${battery.netPowerWatts > 0 ? "充入" : "放出"} ${watts(Math.abs(battery.netPowerWatts))}`);
  return parts.length ? parts.join(" · ") : null;
}

export function describeBatteryHealth(battery: BatteryStats | null | undefined): string | null {
  if (!battery) return null;
  const parts: string[] = [];
  if (battery.healthPercent != null) parts.push(`最大容量 ${Math.round(battery.healthPercent)}%`);
  if (battery.cycleCount != null) parts.push(`循环 ${battery.cycleCount} 次`);
  if (battery.temperatureC != null) parts.push(`${battery.temperatureC.toFixed(1)} °C`);
  if (battery.condition) parts.push(battery.condition === "Good" ? "状态良好" : battery.condition === "Service Recommended" ? "建议维修" : battery.condition);
  return parts.length ? parts.join(" · ") : null;
}

const THERMAL_LABELS: Record<ThermalPressureLevel, string> = { nominal: "正常", moderate: "中等", heavy: "严重", trapping: "临界", sleeping: "过热休眠" };
const MEMORY_PRESSURE_LABELS: Record<MemoryPressureLevel, string> = { normal: "正常", warning: "偏高", critical: "严重" };

export function describeThermalPressure(level: ThermalPressureLevel | null | undefined): string | null {
  return level ? THERMAL_LABELS[level] ?? level : null;
}

export function describeMemoryPressure(level: MemoryPressureLevel | null | undefined): string | null {
  return level ? MEMORY_PRESSURE_LABELS[level] ?? level : null;
}

export function describeMemoryModules(latest: Pick<MetricsLatest, "memoryType" | "memoryFormFactor" | "memorySpeedMHz" | "memorySlotCount">): string | null {
  const parts: string[] = [];
  if (latest.memoryType) parts.push(latest.memoryType);
  if (latest.memoryFormFactor) parts.push(latest.memoryFormFactor === "On-package" ? "统一内存（封装内）" : latest.memoryFormFactor);
  if (latest.memorySpeedMHz != null && latest.memorySpeedMHz > 0) parts.push(`${Math.round(latest.memorySpeedMHz)} MHz`);
  if (latest.memorySlotCount != null && latest.memorySlotCount > 0) parts.push(`${latest.memorySlotCount} 条`);
  return parts.length ? parts.join(" · ") : null;
}

export function describeNetworkLink(network: Pick<NetworkInterfaceStats, "connectionType" | "linkSpeedMbps" | "signalStrengthPercent" | "rssiDbm"> | undefined): string | null {
  if (!network) return null;
  const parts: string[] = [];
  if (network.connectionType) parts.push(network.connectionType === "Ethernet" ? "以太网" : network.connectionType);
  if (network.linkSpeedMbps != null && network.linkSpeedMbps > 0) parts.push(formatLinkSpeed(network.linkSpeedMbps));
  if (network.signalStrengthPercent != null) {
    parts.push(`信号 ${Math.round(network.signalStrengthPercent)}%${network.rssiDbm != null ? `（${Math.round(network.rssiDbm)} dBm）` : ""}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Rows appended to the hardware table only when the device reported them. */
export function extraHardwareRows(latest: MetricsLatest | undefined): Array<{ label: string; value: string }> {
  if (!latest) return [];
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };
  push("CPU 集群", describeClusters(latest.cpuPackages.length === 1 ? latest.cpuPackages[0].clusters : undefined));
  push("内存规格", describeMemoryModules(latest));
  if (latest.memoryCompressedBytes != null && latest.memoryCompressedBytes > 0) push("压缩内存", bytesSize(latest.memoryCompressedBytes));
  push("内存压力", describeMemoryPressure(latest.memoryPressureLevel));
  push("热压力", describeThermalPressure(latest.thermal?.pressureLevel));
  push("供电", describePowerSource(latest.power, latest.battery));
  push("功耗", describePower(latest.power));
  push("电池", describeBattery(latest.battery));
  push("电池健康", describeBatteryHealth(latest.battery));
  return rows;
}
