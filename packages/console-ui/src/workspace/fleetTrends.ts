import type { DeviceMetricKey, DeviceSummary, OverviewInstanceSeries, SamplePoint } from "@dsc/shared";
import { dateValueOf } from "./sampleTime.ts";
import type { DeviceGroupSummary } from "./selectors.ts";

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

export interface GroupNetworkRateSummary {
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  totalBytesPerSec: number | null;
  reportingCount: number;
}

export interface GroupFleetTrend {
  groupKey: string;
  groupName: string;
  isUngrouped: boolean;
  points: SamplePoint[];
  offline: boolean;
  deviceCount: number;
  onlineCount: number;
}

export interface GroupFleetTrendSelection {
  trends: GroupFleetTrend[];
  percent: boolean;
  missingCapacityGroups: string[];
}

export function selectGroupNetworkRates(
  instances: readonly OverviewInstanceSeries[] | undefined,
  groups: readonly DeviceGroupSummary[]
): Map<string, GroupNetworkRateSummary> {
  const instanceById = new Map((instances ?? []).map((inst) => [inst.deviceId, inst]));
  const result = new Map<string, GroupNetworkRateSummary>();
  for (const group of groups) {
    let rxSum = 0;
    let txSum = 0;
    let reportingCount = 0;
    for (const device of group.devices) {
      if (device.status !== "online") continue;
      const inst = instanceById.get(device.deviceId);
      if (!inst) continue;
      const rxUnavailable = inst.unavailableMetrics?.includes("networkRxRate") ?? false;
      const txUnavailable = inst.unavailableMetrics?.includes("networkTxRate") ?? false;
      const rx = rxUnavailable ? null : latestPointValue(inst.networkRxBytesPerSec);
      const tx = txUnavailable ? null : latestPointValue(inst.networkTxBytesPerSec);
      if (rx == null && tx == null) continue;
      rxSum += rx ?? 0;
      txSum += tx ?? 0;
      reportingCount += 1;
    }
    result.set(
      group.key,
      reportingCount > 0
        ? { rxBytesPerSec: rxSum, txBytesPerSec: txSum, totalBytesPerSec: rxSum + txSum, reportingCount }
        : { rxBytesPerSec: null, txBytesPerSec: null, totalBytesPerSec: null, reportingCount: 0 }
    );
  }
  return result;
}

function estimateBucketStepMs(seriesList: ReadonlyArray<readonly SamplePoint[]>): number {
  const deltas: number[] = [];
  for (const points of seriesList) {
    let prev = NaN;
    for (const point of points) {
      const time = dateValueOf(point.timestamp);
      if (!Number.isFinite(time) || !Number.isFinite(point.value)) continue;
      if (Number.isFinite(prev) && time > prev) {
        deltas.push(time - prev);
        if (deltas.length >= 48) break;
      }
      prev = time;
    }
    if (deltas.length >= 48) break;
  }
  if (!deltas.length) return 1000;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.max(1000, Math.min(60_000, Math.round(median / 2)));
}

function aggregateGroupSeries(
  entries: Array<{ points: readonly SamplePoint[]; weight?: number }>,
  mode: "mean" | "sum" | "weighted_share"
): SamplePoint[] {
  if (!entries.length) return [];
  const stepMs = estimateBucketStepMs(entries.map((entry) => entry.points));
  // Deduplicate each device within a bucket first so rapid retries never double-count.
  const buckets = new Map<number, { valueSum: number; weightSum: number; count: number }>();
  for (const entry of entries) {
    const perDeviceBuckets = new Map<number, number>();
    for (const point of entry.points) {
      const time = dateValueOf(point.timestamp);
      if (!Number.isFinite(time) || !Number.isFinite(point.value)) continue;
      const bucketKey = Math.round(time / stepMs) * stepMs;
      perDeviceBuckets.set(bucketKey, point.value);
    }
    const weight = entry.weight ?? 1;
    for (const [bucketKey, val] of perDeviceBuckets) {
      const bucket = buckets.get(bucketKey) ?? { valueSum: 0, weightSum: 0, count: 0 };
      bucket.valueSum += val;
      bucket.weightSum += weight;
      bucket.count += 1;
      buckets.set(bucketKey, bucket);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketKey, bucket]) => {
      const value =
        mode === "sum"
          ? bucket.valueSum
          : mode === "weighted_share"
            ? bucket.weightSum > 0
              ? Math.min(100, Math.max(0, (bucket.valueSum / bucket.weightSum) * 100))
              : 0
            : bucket.valueSum / Math.max(1, bucket.count);
      return { timestamp: new Date(bucketKey).toISOString(), value };
    });
}

export function selectGroupFleetTrends(
  instances: readonly OverviewInstanceSeries[],
  groups: readonly DeviceGroupSummary[],
  metric: FleetMetric
): GroupFleetTrendSelection {
  const instanceById = new Map(instances.map((inst) => [inst.deviceId, inst]));
  const trends: GroupFleetTrend[] = [];
  const missingCapacityGroups: string[] = [];

  for (const group of groups) {
    const offline = group.online === 0;
    const candidates = group.online > 0
      ? group.devices.filter((device) => device.status === "online")
      : group.devices;
    const entries: Array<{ points: readonly SamplePoint[]; weight?: number }> = [];
    let hadCandidateWithoutCapacity = false;

    for (const device of candidates) {
      const inst = instanceById.get(device.deviceId);
      if (!inst) continue;
      const unavailable = UNAVAILABLE_KEYS[metric].some((key) => inst.unavailableMetrics?.includes(key));
      if (unavailable) continue;

      if (metric === "cpu") {
        if (inst.cpuUsagePercent.length > 0) entries.push({ points: inst.cpuUsagePercent });
      } else if (metric === "network") {
        const net = sumRates(inst.networkRxBytesPerSec, inst.networkTxBytesPerSec);
        if (net.length > 0) entries.push({ points: net });
      } else {
        const total = metric === "memory" ? device.memoryTotalBytes : device.diskTotalBytes;
        const usedPoints = metric === "memory" ? inst.memoryUsedBytes : inst.diskUsedBytes;
        if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
          if (usedPoints.length > 0) hadCandidateWithoutCapacity = true;
          continue;
        }
        if (usedPoints.length > 0) {
          entries.push({ points: usedPoints, weight: total });
        }
      }
    }

    if ((metric === "memory" || metric === "disk") && entries.length === 0 && hadCandidateWithoutCapacity) {
      missingCapacityGroups.push(group.name);
      continue;
    }

    const mode = metric === "cpu" ? "mean" : metric === "network" ? "sum" : "weighted_share";
    trends.push({
      groupKey: group.key,
      groupName: group.name,
      isUngrouped: group.isUngrouped,
      points: aggregateGroupSeries(entries, mode),
      offline,
      deviceCount: group.total,
      onlineCount: group.online
    });
  }

  return {
    trends,
    percent: metric !== "network",
    missingCapacityGroups
  };
}
