import type { SamplePoint } from "@dsc/shared";
import { dateValueOf } from "./sampleTime.ts";

export type InspectableSeries = {
  label: string;
  points: SamplePoint[];
  valueFormatter?: (value: number) => string;
};

export type ChartInspectionIndex = {
  timeline: number[];
  points: Array<Map<number, SamplePoint>>;
};

export type ChartInspection = {
  timestamp: number;
  values: Array<{ label: string; point: SamplePoint | null; valueText: string }>;
};

/** A shared timeline avoids assuming every curve has the same sample indexes. */
export function indexChartSamples(series: InspectableSeries[]): ChartInspectionIndex {
  const timestamps = new Set<number>();
  const points = series.map((item) => {
    const samples = new Map<number, SamplePoint>();
    for (const point of item.points) {
      const time = dateValueOf(point.timestamp);
      if (!Number.isFinite(time) || !Number.isFinite(point.value)) continue;
      timestamps.add(time);
      samples.set(time, point);
    }
    return samples;
  });
  return { timeline: [...timestamps].sort((a, b) => a - b), points };
}

export function nearestChartTime(timeline: number[], target: number): number | null {
  if (!timeline.length || !Number.isFinite(target)) return null;
  let low = 0;
  let high = timeline.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timeline[middle] < target) low = middle + 1;
    else high = middle;
  }
  const right = timeline[Math.min(low, timeline.length - 1)];
  const left = timeline[Math.max(0, low - 1)];
  return target - left <= right - target ? left : right;
}

export function inspectChartTime(
  series: InspectableSeries[],
  index: ChartInspectionIndex,
  timestamp: number,
  formatter?: (value: number) => string
): ChartInspection {
  return {
    timestamp,
    values: series.map((item, position) => {
      // No interpolation, zero filling, or values from a different timestamp.
      const point = index.points[position]?.get(timestamp) ?? null;
      return { label: item.label, point, valueText: point ? (item.valueFormatter ?? formatter ?? String)(point.value) : "—" };
    })
  };
}

export function latestChartValues(series: InspectableSeries[], index: ChartInspectionIndex, formatter?: (value: number) => string): ChartInspection | null {
  if (!index.timeline.length) return null;
  return {
    timestamp: index.timeline[index.timeline.length - 1],
    values: series.map((item, position) => {
      const samples = index.points[position];
      let lastTime = -Infinity;
      let point: SamplePoint | null = null;
      for (const [time, sample] of samples) {
        if (time > lastTime) { lastTime = time; point = sample; }
      }
      return { label: item.label, point, valueText: point ? (item.valueFormatter ?? formatter ?? String)(point.value) : "—" };
    })
  };
}

/** SVG coordinates must be scaled when CSS resizes the drawing. */
export function chartTimeAtClientX(clientX: number, bounds: { left: number; width: number }, svgWidth: number, left: number, right: number, min: number, max: number): number {
  const x = (clientX - bounds.left) * svgWidth / Math.max(1, bounds.width);
  const ratio = Math.max(0, Math.min(1, (x - left) / Math.max(1, svgWidth - left - right)));
  return min + ratio * (max - min);
}

export type ChartGestureDirection = "pending" | "horizontal" | "vertical";
export function chartGestureDirection(direction: ChartGestureDirection, dx: number, dy: number): ChartGestureDirection {
  if (direction !== "pending" || Math.max(Math.abs(dx), Math.abs(dy)) < 6) return direction;
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}
