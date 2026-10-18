import type { DeviceMetricKey, DeviceSummary, OverviewInstanceSeries, SamplePoint } from "@dsc/shared";
import { dateValueOf } from "./sampleTime.ts";

/* =============================================================================
 * Fleet trends for the overview.
 *
 * The overview compares machines with each other, so every curve on it has to
 * share one unit. CPU already is a percentage; memory and disk arrive as bytes,
 * and 40 GB used means "nearly full" on a 48 GB server and "idle" on a 256 GB
 * one. They are converted to percent of each device's own capacity, which is
 * also the unit of the thresholds drawn on the chart. Network stays a rate: it
 * has no capacity, and each device is drawn as one line (receive + send) so a
 * fleet of N machines is N curves rather than 2N.
 * ========================================================================== */

export type FleetMetric = "cpu" | "memory" | "disk" | "network";

export interface FleetTrend {
  deviceId: string;
  hostname: string;
  points: SamplePoint[];
  /** The device is not reporting: its line is history, not the present. */
  offline: boolean;
}

export interface FleetTrendSelection {
  trends: FleetTrend[];
  /** True when every value is a percentage on a 0–100 axis. */
  percent: boolean;
  /** Devices left out because their capacity is unknown, so a share cannot be computed. */
  missingCapacity: string[];
}

const UNAVAILABLE_KEYS: Record<FleetMetric, DeviceMetricKey[]> = {
  cpu: ["cpuUsage"],
  memory: ["memoryUsage"],
  disk: ["diskUsage"],
  network: ["networkRxRate", "networkTxRate"]
};

function share(points: readonly SamplePoint[], total: number): SamplePoint[] {
  return points
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ timestamp: point.timestamp, value: Math.min(100, Math.max(0, (point.value / total) * 100)) }));
}

/** Receive plus send at each instant either side reported. */
export function sumRates(rx: readonly SamplePoint[], tx: readonly SamplePoint[]): SamplePoint[] {
  const totals = new Map<string, number>();
  for (const point of [...rx, ...tx]) {
    if (!Number.isFinite(point.value)) continue;
    totals.set(point.timestamp, (totals.get(point.timestamp) ?? 0) + point.value);
  }
  return [...totals.entries()]
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((left, right) => dateValueOf(left.timestamp) - dateValueOf(right.timestamp));
}

export function selectFleetTrends(instances: readonly OverviewInstanceSeries[], devices: readonly DeviceSummary[], metric: FleetMetric): FleetTrendSelection {
  const byId = new Map(devices.map((device) => [device.deviceId, device]));
  const trends: FleetTrend[] = [];
  const missingCapacity: string[] = [];
  for (const instance of instances) {
    const device = byId.get(instance.deviceId);
    const offline = device ? device.status !== "online" : false;
    const unavailable = UNAVAILABLE_KEYS[metric].some((key) => instance.unavailableMetrics?.includes(key));
    const base = { deviceId: instance.deviceId, hostname: device?.hostname ?? instance.hostname, offline };
    if (unavailable) {
      trends.push({ ...base, points: [] });
      continue;
    }
    if (metric === "cpu") {
      trends.push({ ...base, points: instance.cpuUsagePercent });
    } else if (metric === "network") {
      trends.push({ ...base, points: sumRates(instance.networkRxBytesPerSec, instance.networkTxBytesPerSec) });
    } else {
      const total = metric === "memory" ? device?.memoryTotalBytes : device?.diskTotalBytes;
      if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
        missingCapacity.push(base.hostname);
        continue;
      }
      trends.push({ ...base, points: share(metric === "memory" ? instance.memoryUsedBytes : instance.diskUsedBytes, total) });
    }
  }
  return { trends, percent: metric !== "network", missingCapacity };
}

/** The most recent finite reading of a series, or null. */
export function latestPointValue(points: readonly SamplePoint[] | undefined): number | null {
  if (!points) return null;
  for (let index = points.length - 1; index >= 0; index--) {
    if (Number.isFinite(points[index].value)) return points[index].value;
  }
  return null;
}
