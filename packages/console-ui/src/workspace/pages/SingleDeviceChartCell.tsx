import React, { useId, useMemo, useState } from "react";
import type { DashboardChartSpec } from "../dashboard";
import { ChartTile } from "../dashboard";
import { TimeSeriesChart, ChartReadout, CapacityList, NumberGrid, type ChartInspection } from "../charts";
import { indexChartSamples, latestChartValues } from "../chartInspection.ts";
import type { DeviceChartTile } from "./deviceCharts";
import { ChartInfoRows } from "./deviceCharts";
import { DeviceChartSheet } from "./DeviceChartSheet";

export function SingleDeviceChartCell({
  chart,
  tile
}: {
  chart: DashboardChartSpec;
  tile: DeviceChartTile;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<ChartInspection | null>(null);
  const readoutId = useId();
  const isTrend = chart.visualization === "line" || chart.visualization === "area";
  const latest = useMemo(() => latestChartValues(tile.series ?? [], indexChartSamples(tile.series ?? []), tile.valueFormatter), [tile.series, tile.valueFormatter]);

  let bodyNode: React.ReactNode;
  switch (chart.visualization) {
    case "capacity":
      bodyNode = <CapacityList rows={tile.capacity ?? []} ariaLabel={`${tile.title ?? chart.title}容量`} />;
      break;
    case "number":
      bodyNode = <NumberGrid items={tile.numbers ?? []} />;
      break;
    case "table":
      bodyNode = <ChartInfoRows rows={tile.rows ?? []} label={chart.title} />;
      break;
    case "custom":
      bodyNode = <>{tile.node}</>;
      break;
    default:
      bodyNode = (
        <TimeSeriesChart
          series={tile.series ?? []}
          visualization={chart.visualization === "area" ? "area" : "line"}
          maxValue={tile.maxValue}
          thresholds={tile.thresholds}
          valueFormatter={tile.valueFormatter}
          compact={chart.compact}
          onHoverPoint={setHoveredPoint}
          hideReadout
          readoutId={readoutId}
        />
      );
      break;
  }

  // 自定义面板（Agent、流量日历、温度源）的主体本身就是明细，不再套一层详情；
  // 曲线一个有效样本都没有时统计区为空，不能只凭「有 series」就给出一个空详情。
  const hasSamples = tile.series?.some((item) => item.points.some((point) => Number.isFinite(point.value))) ?? false;
  const hasSheetContent = chart.visualization !== "custom"
    && Boolean(tile.subtitle || tile.facts?.length || tile.models || hasSamples);

  return (
    <ChartTile
      title={tile.title ?? chart.title}
      subtitle={tile.subtitle}
      heroStat={isTrend ? undefined : tile.heroStat}
      heroBadge={isTrend ? undefined : tile.heroBadge}
      readout={isTrend && !tile.emptyMessage ? <ChartReadout info={hoveredPoint ?? latest} inspecting={Boolean(hoveredPoint)} id={readoutId} compact /> : undefined}
      controls={tile.controls}
      emptyMessage={tile.emptyMessage}
      sheet={hasSheetContent ? <DeviceChartSheet tile={{ ...tile, title: tile.title ?? chart.title }} /> : undefined}
    >
      {bodyNode}
    </ChartTile>
  );
}
