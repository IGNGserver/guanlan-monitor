import type { SamplePoint } from "@dsc/shared";
import { dateValueOf } from "./sampleTime.ts";

export const UNAVAILABLE_METRIC_LABEL = "无法获取数据";
export const NOT_APPLICABLE_LABEL = "不适用";

const METRIC_KEY_LABELS: Record<string, string> = {
  cpuUsage: "CPU 使用率",
  cpuFrequency: "CPU 主频",
  cpuTemperature: "CPU 温度",
  cpuTopology: "CPU 拓扑",
  systemOverview: "系统进程概览",
  gpuUsage: "GPU 使用率",
  gpuEncode: "GPU 编码",
  gpuDecode: "GPU 解码",
  gpuFrequency: "GPU 频率",
  gpuMemory: "显存占用",
  gpuTemperature: "GPU 温度",
  gpuDriverInfo: "显卡驱动信息",
  temperatureSources: "温度传感器",
  memoryUsage: "物理内存占用",
  swapUsage: "交换分区（Swap）",
  memoryAvailable: "可用内存",
  memoryCached: "缓存内存",
  memoryCommitted: "已提交内存",
  memoryHardware: "内存硬件规格",
  diskUsage: "磁盘空间占用",
  diskRead: "磁盘读取速率",
  diskWrite: "磁盘写入速率",
  diskMetadata: "磁盘硬件信息",
  diskActivity: "磁盘活动时间",
  diskHealth: "磁盘 SMART 健康度",
  storagePools: "虚拟化存储池",
  networkRxRate: "网络下行速率",
  networkTxRate: "网络上行速率",
  networkTraffic: "历史流量统计",
  networkIdentity: "网卡地址信息",
  fanRpm: "风扇转速",
  fanControl: "风扇控制模式",
  fanTargetTemperature: "风扇目标温度",
  fanPwm: "风扇占空比",
  fanChannelState: "风扇通道状态",
  fanNote: "风扇备注"
};

export function formatMetricKeyLabel(key: string): string {
  return METRIC_KEY_LABELS[key] ?? key;
}

export function formatDeviceOs(os: string | null | undefined): string {
  const normalized = os?.trim().toLowerCase();
  if (normalized === "windows") return "Windows";
  if (normalized === "linux") return "Linux";
  if (normalized === "macos" || normalized === "darwin") return "macOS";
  if (!normalized || normalized === "unknown") return "未知系统";
  return os!.trim();
}

// One formatter per style, built once. `new Intl.DateTimeFormat` is a heavy
// constructor and these run inside per-row and per-poll render paths; creating
// one per call was measurable churn on every refresh.
const shortDateTimeFormat = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const axisTimeFormat = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const preciseDateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return shortDateTimeFormat.format(date);
}
export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : 1;
  if (Number(amount.toFixed(digits)) >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * Percentages are read as a magnitude, not as a measurement: the hub answers
 * with `66.69`, and a directory that printed `66.69%` next to a chart saying
 * `67%` made the two look like different metrics. One rounding rule now lives
 * here, and a value that is not a number renders as a dash instead of `NaN%`.
 */
export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const clamped = Math.min(100, Math.max(0, value));
  const rounded = Math.round(clamped);
  return `${Object.is(rounded, -0) ? 0 : rounded}%`;
}

/**
 * A rate formatter, hoisted so chart options memoisation is not defeated by a
 * fresh inline arrow on every render. One shared instance also keeps the tooltip
 * and the hero stat reading the same way.
 */
export function formatRate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  return value > 0 ? `${formatBytes(value)}/s` : "0 B/s";
}

/** One place writes temperatures, always as number + space + unit. */
export function formatTemperature(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${digits > 0 ? value.toFixed(digits) : Math.round(value)} °C`;
}

/**
 * A bare MAC address next to a bare IP address reads as noise: neither says
 * which field it is, and the same interface appeared with one half in the chart
 * subtitle and the other half in the model chip. Label both, in one place.
 */
export function describeNetworkIdentity(network: { name?: string; macAddress?: string | null; ipv4?: string[] | null; ipv6?: string[] | null }): string {
  const address = network.ipv4?.[0] ? `IPv4 ${network.ipv4[0]}` : network.ipv6?.[0] ? `IPv6 ${network.ipv6[0]}` : "";
  return [network.name, network.macAddress ? `MAC ${network.macAddress}` : "", address].filter(Boolean).join(" · ");
}

export function formatCapacitySummary(usedBytes: number | null | undefined, totalBytes: number | null | undefined, unavailable = false): string {
  if (unavailable) {
    return Number.isFinite(totalBytes) && (totalBytes ?? 0) > 0
      ? `${UNAVAILABLE_METRIC_LABEL} · 总容量 ${formatBytes(totalBytes)}`
      : UNAVAILABLE_METRIC_LABEL;
  }
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || (totalBytes ?? 0) <= 0) return "容量暂无";
  return `已用 ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

export function gpuMemoryLabel(memoryKind: string | null | undefined): string {
  if (memoryKind === "shared") return "共享显存";
  if (memoryKind === "unified") return "统一内存";
  if (memoryKind === "dedicated") return "独立显存";
  return "GPU 内存";
}

export function formatGpuMemorySummary(
  gpus: Array<{ memoryUsedBytes: number; memoryTotalBytes: number; memoryKind?: string | null }>
): string {
  const groups = new Map<string, { usedBytes: number; totalBytes: number }>();
  for (const gpu of gpus) {
    const label = gpuMemoryLabel(gpu.memoryKind);
    const current = groups.get(label) ?? { usedBytes: 0, totalBytes: 0 };
    current.usedBytes += Number.isFinite(gpu.memoryUsedBytes) ? gpu.memoryUsedBytes : 0;
    current.totalBytes += Number.isFinite(gpu.memoryTotalBytes) ? gpu.memoryTotalBytes : 0;
    groups.set(label, current);
  }
  const summaries = [...groups.entries()].map(([label, values]) =>
    values.totalBytes > 0
      ? `${label}：${formatCapacitySummary(values.usedBytes, values.totalBytes)}`
      : values.usedBytes > 0
        ? `${label}：已用 ${formatBytes(values.usedBytes)} / 容量未知`
        : `${label}：容量暂无`
  );
  return summaries.length ? summaries.join(" · ") : "容量暂无";
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "未采集";
  if (seconds > 0 && seconds < 60) return "< 1 分钟";
  let remaining = Math.max(0, Math.round(seconds));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours || days) parts.push(`${hours} 小时`);
  parts.push(`${minutes} 分钟`);
  return parts.join(" ");
}

export function formatCount(value: number | null | undefined): string {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? Math.round(value ?? 0).toLocaleString("zh-CN") : "未采集";
}

export function formatAxisTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return axisTimeFormat.format(date);
}

export function formatPreciseDateTime(value: string | null | undefined): string {
  if (!value) return "暂无时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return preciseDateTimeFormat.format(date);
}

export function averageSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number; count: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = dateValueOf(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) continue;
      // Different probes can stamp the same collection cycle a few
      // milliseconds apart. Normalize to one-second buckets before merging;
      // exact-string matching would make the aggregate line flicker between
      // multiple partial samples.
      const bucketTimestamp = Math.round(timestamp / 1000) * 1000;
      const current = buckets.get(bucketTimestamp) ?? {
        timestamp: new Date(bucketTimestamp).toISOString(),
        total: 0,
        count: 0
      };
      current.total += point.value;
      current.count += 1;
      buckets.set(bucketTimestamp, current);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket]) => ({ timestamp: bucket.timestamp, value: bucket.total / bucket.count }));
}

export function averageSamplePointsOrFallback(groups: SamplePoint[][], fallback: SamplePoint[]): SamplePoint[] {
  const average = averageSamplePoints(groups);
  return average.length ? average : fallback;
}

export function sumSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = dateValueOf(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) continue;
      const bucketTimestamp = Math.round(timestamp / 1000) * 1000;
      const current = buckets.get(bucketTimestamp) ?? {
        timestamp: new Date(bucketTimestamp).toISOString(),
        total: 0
      };
      current.total += point.value;
      buckets.set(bucketTimestamp, current);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket]) => ({ timestamp: bucket.timestamp, value: bucket.total }));
}

export function limitSamplePoints(points: SamplePoint[], maxPoints = 240): SamplePoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const limited: SamplePoint[] = [];
  let lastIndex = -1;
  for (let index = 0; index < maxPoints; index++) {
    const sourceIndex = Math.round((index * (points.length - 1)) / (maxPoints - 1));
    if (sourceIndex === lastIndex) continue;
    limited.push(points[sourceIndex]);
    lastIndex = sourceIndex;
  }
  return limited;
}

export function displayInstanceName(name: string | undefined, fallback: string): string {
  const value = name?.trim();
  return value || fallback;
}

/**
 * `ReleaseChannel` is `"stable" | "test"` on the wire. Both the device facts
 * card and the About page used to print the raw value, so users read the English
 * enum ("test") where every other label on the screen is Chinese. One word for
 * one channel, everywhere.
 */
export function formatReleaseChannel(value: string | null | undefined): string {
  if (value === "stable") return "稳定版";
  if (value === "test") return "测试版";
  const trimmed = value?.trim();
  return trimmed ? trimmed : "未知";
}

export function displayModelName(model: string | undefined, name: string | undefined, fallback: string): string {
  return displayInstanceName(model, displayInstanceName(name, fallback));
}

export const WINDOW_DURATION_MAP: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 86400 * 1000
};

export function splitPointsIntoSegments(points: SamplePoint[], windowDurationMs: number): SamplePoint[][] {
  if (points.length <= 1) return [points];

  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = dateValueOf(points[i].timestamp) - dateValueOf(points[i - 1].timestamp);
    if (d > 0) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 5000;
  const gapThreshold = Math.max(medianDelta * 4, 45000, windowDurationMs * 0.15);

  const segments: SamplePoint[][] = [];
  let currentSegment: SamplePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prevT = dateValueOf(points[i - 1].timestamp);
    const currT = dateValueOf(points[i].timestamp);
    if (currT - prevT > gapThreshold) {
      segments.push(currentSegment);
      currentSegment = [points[i]];
    } else {
      currentSegment.push(points[i]);
    }
  }
  if (currentSegment.length) segments.push(currentSegment);
  return segments;
}
