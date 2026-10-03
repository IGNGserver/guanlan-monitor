import { dateValueOf } from "./sampleTime.ts";

/**
 * Pure identity/format helpers for the charts.
 *
 * They live outside `charts.tsx` so the Node test runner can exercise them
 * without importing browser DOM dependencies.
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
 * whose data did not change, while invalidating corrected historical samples as
 * well as newly appended ones. This is a content key, not a security boundary.
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
    for (const point of points) {
      mix(dateValueOf(point.timestamp) % 2147483647);
      const value = String(point.value);
      for (let index = 0; index < value.length; index++) mix(value.charCodeAt(index));
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
