import { dateValueOf } from "./sampleTime.ts";

/**
 * Pure identity/format helpers for the charts.
 *
 * They live outside `CarbonCharts.tsx` so the Node test runner can exercise them
 * without importing the Carbon/d3 renderer, which needs a DOM.
 */

export type IdentifiedSeries = {
  label: string;
  points: Array<{ timestamp: string; value: number }>;
};

/**
 * A content fingerprint for a series array.
 *
 * The dashboard rebuilds each chart's `series` on every render, so a memo keyed
 * on the array identity never hits and every poll re-runs the point filtering and
 * axis-range scan. Fingerprinting the actual values lets the memo survive a poll
 * whose data did not change, while still invalidating the moment a timestamp or
 * value does. Length plus the first/last timestamp and a cheap rolling hash of the
 * labels and last values is enough to distinguish a real update from a re-render;
 * it is not a security boundary.
 */
export function seriesFingerprint(series: IdentifiedSeries[]): string {
  let hash = 2166136261;
  const mix = (part: number) => {
    hash ^= part | 0;
    hash = Math.imul(hash, 16777619);
  };
  for (const item of series) {
    const points = item.points;
    mix(points.length);
    for (let index = 0; index < item.label.length; index++) mix(item.label.charCodeAt(index));
    if (points.length) {
      mix(dateValueOf(points[0].timestamp) % 2147483647);
      const last = points[points.length - 1];
      mix(dateValueOf(last.timestamp) % 2147483647);
      mix(Math.round(last.value * 1000));
    }
  }
  return `${series.length}:${hash >>> 0}`;
}

/** Stable content key for a donut/meter's parts. */
export function partsFingerprint(parts: Array<{ label: string; value: number }>): string {
  return parts.map((part) => `${part.label}:${part.value}`).join("|");
}

/**
 * Whether a chart should run its enter/update transition.
 *
 * The dashboard re-supplies data on every status poll, so leaving transitions on
 * means a d3 animation per chart per poll for values that moved a fraction of a
 * pixel. Reduced-motion preference is the existing, user-controlled signal for
 * "do not animate"; the first paint still renders without one.
 */
export function chartAnimationsEnabled(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/** Reads the reduced-motion preference; safe outside a browser. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One pass over every point to find the timestamp span, instead of three. */
export function seriesTimeSpan(series: IdentifiedSeries[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const item of series) {
    for (const point of item.points) {
      const time = dateValueOf(point.timestamp);
      if (!Number.isFinite(time)) continue;
      if (time < min) min = time;
      if (time > max) max = time;
    }
  }
  return min <= max ? { min, max } : null;
}
