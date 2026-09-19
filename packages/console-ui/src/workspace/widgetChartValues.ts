import type { SamplePoint } from "@dsc/shared";

export function formatNumber(value: number | null | undefined, suffix = ""): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("zh-CN")}${suffix}`;
}

export function latestValue(points: SamplePoint[] | undefined): number | null {
  const point = points?.[points.length - 1];
  return point && Number.isFinite(point.value) ? point.value : null;
}
