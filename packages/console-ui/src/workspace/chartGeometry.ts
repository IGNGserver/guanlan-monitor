/* =============================================================================
 * Time-series geometry for monitoring charts.
 *
 * Pure functions, no React, so the drawing rules are unit-testable:
 *
 * - A curve breaks where samples stop. Joining across an outage drew a line
 *   through hours the Agent never reported, which reads as "the machine was
 *   fine" exactly when it was not.
 * - Curves are monotone cubic (Fritsch–Carlson). The previous Catmull-Rom
 *   spline overshot every spike, so a 100 % CPU plateau rendered above 100 %
 *   and an idle dip below zero.
 * - Axis ticks land on round values (1/2/2.5/5 × 10ⁿ, or binary steps for
 *   byte quantities) and round clock times, instead of thirds of the range.
 * ========================================================================== */

export type XY = { x: number; y: number };

/** Median spacing of a time-ordered list, or null with fewer than two samples. */
export function typicalInterval(timestamps: readonly number[]): number | null {
  if (timestamps.length < 2) return null;
  const gaps: number[] = [];
  for (let index = 1; index < timestamps.length; index++) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (!gaps.length) return null;
  gaps.sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * The silence that counts as an outage: three typical intervals. Collectors
 * jitter and the hub buckets long ranges, so one late sample is not a gap.
 */
export function gapThreshold(timestamps: readonly number[]): number {
  const interval = typicalInterval(timestamps);
  return interval == null ? Number.POSITIVE_INFINITY : interval * 3;
}

/** Split time-ordered items wherever consecutive timestamps are further apart than `maxGap`. */
export function splitAtGaps<T>(items: readonly T[], timeOf: (item: T) => number, maxGap: number): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    const previous = current[current.length - 1];
    if (previous !== undefined && timeOf(item) - timeOf(previous) > maxGap) {
      runs.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) runs.push(current);
  return runs;
}

/** Spans of a merged timeline in which no series reported, wider than `maxGap`. */
export function silentSpans(timeline: readonly number[], maxGap: number): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let index = 1; index < timeline.length; index++) {
    if (timeline[index] - timeline[index - 1] > maxGap) spans.push([timeline[index - 1], timeline[index]]);
  }
  return spans;
}

/**
 * Monotone cubic path through every point (Fritsch–Carlson tangents). Between
 * two samples the curve never leaves their value range, so it cannot invent a
 * peak or a trough the data does not contain.
 */
export function monotonePath(points: readonly XY[]): string {
  const count = points.length;
  if (!count) return "";
  if (count === 1) return `M${points[0].x} ${points[0].y}`;
  if (count === 2) return `M${points[0].x} ${points[0].y}L${points[1].x} ${points[1].y}`;
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index++) {
    const dx = points[index + 1].x - points[index].x;
    slopes.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx);
  }
  const tangents: number[] = [slopes[0]];
  for (let index = 1; index < count - 1; index++) {
    const left = slopes[index - 1];
    const right = slopes[index];
    tangents.push(left * right <= 0 ? 0 : (left + right) / 2);
  }
  tangents.push(slopes[count - 2]);
  for (let index = 0; index < count - 1; index++) {
    const slope = slopes[index];
    if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
    const a = tangents[index] / slope;
    const b = tangents[index + 1] / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < count - 1; index++) {
    const p0 = points[index];
    const p1 = points[index + 1];
    const third = (p1.x - p0.x) / 3;
    path += `C${p0.x + third} ${p0.y + tangents[index] * third} ${p1.x - third} ${p1.y - tangents[index + 1] * third} ${p1.x} ${p1.y}`;
  }
  return path;
}

function niceDecimalStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw));
  const base = 10 ** exponent;
  const fraction = raw / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

/** Byte quantities step by powers of two inside their 1024ⁿ unit: 256 MB, 512 MB, 1 GB. */
function niceBinaryStep(raw: number): number {
  if (raw < 1) return niceDecimalStep(raw);
  const unit = 1024 ** Math.floor(Math.log(raw) / Math.log(1024));
  return unit * 2 ** Math.ceil(Math.log2(raw / unit));
}

export interface LinearAxis { min: number; max: number; ticks: number[] }

/**
 * A value axis with round ticks. The domain starts at zero (or below it for
 * negative data) and ends on the first round tick at or above the maximum,
 * unless `pinnedMax` fixes it (percentages end at 100).
 */
export function niceLinearAxis(values: readonly number[], options: { pinnedMax?: number; binary?: boolean; tickCount?: number } = {}): LinearAxis {
  const tickCount = options.tickCount ?? 4;
  let low = 0;
  let high = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  // A pinned ceiling is the scale's meaning (percent ends at 100), not a guess.
  if (options.pinnedMax != null) high = options.pinnedMax;
  if (!Number.isFinite(high) || high <= low) high = low + 1;
  const raw = (high - low) / tickCount;
  const step = options.binary ? niceBinaryStep(raw) : niceDecimalStep(raw);
  const min = Math.floor(low / step) * step;
  const max = options.pinnedMax != null ? options.pinnedMax : Math.ceil(high / step) * step;
  const ticks: number[] = [];
  // Rounding guard: accumulate by index, not by repeated addition.
  for (let index = 0; min + index * step <= max + step * 1e-9; index++) ticks.push(min + index * step);
  return { min, max, ticks };
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const TIME_STEPS = [SECOND, 5 * SECOND, 10 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

export interface TimeAxis { step: number; ticks: number[] }

/**
 * Clock-aligned ticks inside [min, max]: whole minutes, hours or local
 * midnights, at most `maxTicks` of them.
 */
export function niceTimeAxis(min: number, max: number, maxTicks: number, timezoneOffsetMinutes = new Date(min).getTimezoneOffset()): TimeAxis {
  const span = Math.max(1, max - min);
  const step = TIME_STEPS.find((candidate) => span / candidate <= maxTicks) ?? Math.ceil(span / maxTicks / DAY) * DAY;
  // Align in local time: `getTimezoneOffset` is minutes *behind* UTC.
  const shift = -timezoneOffsetMinutes * MINUTE;
  const first = Math.ceil((min + shift) / step) * step - shift;
  const ticks: number[] = [];
  for (let tick = first; tick <= max; tick += step) ticks.push(tick);
  return { step, ticks };
}

/** True when a formatter writes byte units, so its axis should step in binary. */
export function formatsBytes(formatter: ((value: number) => string) | undefined): boolean {
  if (!formatter) return false;
  return /\bKB\b/.test(formatter(2048));
}
