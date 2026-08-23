import React from "react";
import type { SamplePoint } from "@dsc/shared";

export const UNAVAILABLE_METRIC_LABEL = "无法获取数据";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function MetricValue({ value, suffix = "%", unavailable = false }: { value: number | null | undefined; suffix?: string; unavailable?: boolean }) {
  return <span className={`workspace-metric-value${unavailable ? " workspace-metric-value--unavailable" : ""}`}>{unavailable ? UNAVAILABLE_METRIC_LABEL : value == null ? "—" : `${value}${suffix}`}</span>;
}

export function CapacityMetricValue({
  usedBytes,
  totalBytes,
  percentValue,
  unavailable = false
}: {
  usedBytes?: number | null;
  totalBytes?: number | null;
  percentValue?: number | null;
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <span className="workspace-metric-value workspace-metric-value--capacity workspace-metric-value--unavailable">
        <strong>{UNAVAILABLE_METRIC_LABEL}</strong>
        {Number.isFinite(totalBytes) && (totalBytes ?? 0) > 0 && <small>总容量 {formatBytes(totalBytes)}</small>}
      </span>
    );
  }
  const hasCapacity = Number.isFinite(usedBytes) && Number.isFinite(totalBytes) && (totalBytes ?? 0) > 0;
  if (!hasCapacity) return <MetricValue value={percentValue} />;
  return (
    <span className="workspace-metric-value workspace-metric-value--capacity">
      <strong>{formatBytes(usedBytes)} / {formatBytes(totalBytes)}</strong>
      {percentValue != null && <small>{percentValue}%</small>}
    </span>
  );
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
  if (!Number.isFinite(seconds)) return "未采集";
  let remaining = Math.max(0, Math.round(seconds ?? 0));
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
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

export function formatPreciseDateTime(value: string | null | undefined): string {
  if (!value) return "暂无时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

export function averageSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number; count: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = Date.parse(point.timestamp);
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
      const timestamp = Date.parse(point.timestamp);
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

export function displayInstanceName(name: string | undefined, fallback: string): string {
  const value = name?.trim();
  return value || fallback;
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
    const d = Date.parse(points[i].timestamp) - Date.parse(points[i - 1].timestamp);
    if (d > 0) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 5000;
  const gapThreshold = Math.max(medianDelta * 4, 45000, windowDurationMs * 0.15);

  const segments: SamplePoint[][] = [];
  let currentSegment: SamplePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prevT = Date.parse(points[i - 1].timestamp);
    const currT = Date.parse(points[i].timestamp);
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
