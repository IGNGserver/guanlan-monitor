import type { SamplePoint } from "@dsc/shared";

const UNTHINNED = new Set(["trafficRxBytes", "trafficTxBytes", "networkRxBytesPerSec", "networkTxBytesPerSec", "rxBytesPerSec", "txBytesPerSec"]);

function hasGap(times: number[]): boolean {
  const deltas = times.slice(1).map((time, index) => time - times[index]);
  if (deltas.some((delta) => !Number.isFinite(delta) || delta <= 0)) return true;
  const ordered = [...deltas].sort((a, b) => a - b);
  return deltas.some((delta) => delta > ordered[Math.floor(ordered.length / 2)] * 3);
}

/** Preserve endpoints, original timestamps and bucket extrema. A target is not
 * a hard cap: never remove a real gap or introduce a false cadence-based gap.
 */
export function budgetPoints(points: SamplePoint[], budget: number): SamplePoint[] {
  if (!Number.isInteger(budget) || budget < 16 || points.length <= budget) return points;
  const times = points.map((point) => Date.parse(point.timestamp));
  if (points.some((point) => !Number.isFinite(point.value)) || times.some((time) => !Number.isFinite(time)) || hasGap(times)) return points;
  const selected = new Set([0, points.length - 1]);
  const buckets = Math.floor((budget - 2) / 2);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * points.length / buckets);
    const end = Math.floor((bucket + 1) * points.length / buckets);
    let min = start, max = start;
    for (let i = start + 1; i < end; i++) {
      if (points[i].value < points[min].value) min = i;
      if (points[i].value > points[max].value) max = i;
    }
    selected.add(min); selected.add(max);
  }
  const result = [...selected].sort((a, b) => a - b).map((index) => points[index]);
  return hasGap(result.map((point) => Date.parse(point.timestamp))) ? points : result;
}

/** Plain metric payloads only. Counter and paired network-rate series remain
 * exact, including reset/total and rate-addition semantics.
 */
export function budgetSeries<T>(value: T, budget?: number): T {
  if (budget === undefined) return value;
  const series: SamplePoint[][] = [];
  const walk = (item: unknown, field = "", replace?: (points: SamplePoint[]) => SamplePoint[]): unknown => {
    if (UNTHINNED.has(field)) return item;
    if (Array.isArray(item)) {
      if (!item.length) return item;
      if (typeof item[0] === "object" && item[0] !== null && "timestamp" in item[0] && "value" in item[0]) {
        if (replace) return replace(item);
        series.push(item); return item;
      }
      return item.map((child) => walk(child, "", replace));
    }
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child, key, replace)]));
    }
    return item;
  };
  walk(value);
  const reference = series[0];
  if (!reference || reference.length <= budget) return value;
  // Clients combine hardware instances and plot several metrics on one axis.
  // Never independently select timestamps: missing partners corrupt sums and
  // averages, while mixed cadences can invent silent spans on a merged axis.
  if (series.some((points) => points.length !== reference.length || points.some((point, index) => point.timestamp !== reference[index].timestamp))) return value;
  const selectedTimes = new Set<string>();
  for (const points of series) {
    const thinned = budgetPoints(points, budget);
    if (thinned === points) return value;
    for (const point of thinned) selectedTimes.add(point.timestamp);
  }
  const selected = reference.map((point, index) => selectedTimes.has(point.timestamp) ? index : -1).filter((index) => index >= 0);
  if (selected.length >= reference.length || hasGap(selected.map((index) => Date.parse(reference[index].timestamp)))) return value;
  return walk(value, "", (points) => selected.map((index) => points[index])) as T;
}
