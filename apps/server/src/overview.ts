import type { DeviceMetricKey, MetricSeries, MetricWindow, SamplePoint } from "@dsc/shared";
import type { OverviewRecord, TimeSeriesRecord } from "./types.js";

export type OverviewSeries = Pick<MetricSeries,
  "cpuUsagePercent" | "memoryUsedBytes" | "diskUsedBytes" | "networkRxBytesPerSec" | "networkTxBytesPerSec">;

const METRICS = {
  cpuUsagePercent: "cpuUsage",
  memoryUsedBytes: "memoryUsage",
  diskUsedBytes: "diskUsage",
  networkRxBytesPerSec: "networkRxRate",
  networkTxBytesPerSec: "networkTxRate"
} as const satisfies Record<keyof OverviewSeries, DeviceMetricKey>;

/** Resolve the same legacy capacity fallbacks as timeSeriesToMetricSeries,
 * without building hardware instances or any of the other chart series.
 */
export function projectOverviewRecord(point: TimeSeriesRecord): OverviewRecord {
  const disks = point.disks?.length ? point.disks : point.recordedDetails?.disks ?? [];
  return {
    timestamp: point.timestamp,
    cpuUsagePercent: point.cpuUsagePercent,
    memoryUsedBytes: Number(Number(point.memoryUsedBytes) > 0 ? point.memoryUsedBytes : point.recordedDetails?.memory?.usedBytes ?? 0),
    diskUsedBytes: Number(point.diskUsedBytes) > 0 ? Number(point.diskUsedBytes)
      : disks.reduce((total, disk) => total + Number(disk.usedBytes ?? 0), 0),
    networkRxBytesPerSec: point.networkRxBytesPerSec,
    networkTxBytesPerSec: point.networkTxBytesPerSec,
    metricQuality: point.recordedDetails?.metricQuality,
    unavailableMetrics: point.recordedDetails?.unavailableMetrics
  };
}

/** Five aggregate curves only. Keep the original gate-before-alignment order:
 * an absent observation is a gap, not an idle zero or a carried reading.
 */
export function overviewToMetricSeries(points: OverviewRecord[], window: MetricWindow = "5m"): OverviewSeries {
  const bucketMs =
    window === "15m" || window === "1h" || window === "6h" || window === "24h" || window === "1d" ? 60_000 :
    window === "7d" || window === "1w" || window === "30d" || window === "1mo" || window === "90d" || window === "1y" ? 3_600_000 : 0;
  const series = {} as OverviewSeries;
  for (const field of Object.keys(METRICS) as Array<keyof OverviewSeries>) {
    const key = METRICS[field];
    const unavailable = new Set<string>();
    const validObservations = new Set(points.flatMap((point) => {
      const quality = point.metricQuality?.[key];
      return quality?.observedAt && (quality.state === "direct" || quality.state === "derived") ? [quality.observedAt] : [];
    }));
    for (const point of points) {
      const quality = point.metricQuality?.[key];
      if (point.unavailableMetrics?.includes(key) || quality?.state === "unavailable" || quality?.state === "not_applicable" || quality?.state === "stale") {
        unavailable.add(new Date(point.timestamp).toISOString());
        if (quality?.observedAt && !validObservations.has(quality.observedAt)) unavailable.add(quality.observedAt);
      }
    }
    const samples = points.map((point) => {
      const numeric = Number(point[field]);
      // The old converter normalizes scalar CPU/rates, but capacity detailSeries
      // uses Number(value ?? 0) directly. Do not silently change that contract.
      const value = field === "memoryUsedBytes" || field === "diskUsedBytes" ? numeric : Number.isFinite(numeric) ? numeric : 0;
      return { timestamp: new Date(point.timestamp).toISOString(), value };
    }).filter((sample) => !unavailable.has(sample.timestamp));
    if (!bucketMs) {
      series[field] = samples;
      continue;
    }
    const aligned = new Map<number, SamplePoint>();
    for (const sample of samples) {
      const time = Math.floor(Date.parse(sample.timestamp) / bucketMs) * bucketMs;
      aligned.set(time, { timestamp: new Date(time).toISOString(), value: sample.value });
    }
    series[field] = [...aligned.entries()].sort((a, b) => a[0] - b[0]).map(([, sample]) => sample);
  }
  return series;
}
