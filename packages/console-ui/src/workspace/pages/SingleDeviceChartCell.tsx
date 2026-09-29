import React, { useState } from "react";
import type { DashboardChartSpec } from "../dashboard";
import { ChartTile } from "../dashboard";
import { CarbonTimeSeriesChart, CarbonDonutChart, CarbonMeterChart, CarbonNumberGrid } from "../CarbonCharts";
import type { DeviceChartTile } from "./deviceCharts";
import { ChartDetails, ChartInfoRows } from "./deviceCharts";

export function SingleDeviceChartCell({
  chart,
  tile
}: {
  chart: DashboardChartSpec;
  tile: DeviceChartTile;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<{ timeText: string; valueText: string } | null>(null);

  const displayHeroStat = hoveredPoint ? hoveredPoint.valueText : tile.heroStat;
  const displayHeroBadge = hoveredPoint ? `时间 ${hoveredPoint.timeText}` : tile.heroBadge;

  const valueFormatter = tile.valueFormatter ?? ((v: number) => String(v));

  let bodyNode: React.ReactNode;
  switch (chart.visualization) {
    case "donut":
      bodyNode = (
        <CarbonDonutChart
          parts={tile.donut?.parts ?? []}
          centerLabel={tile.donut?.centerLabel}
          valueFormatter={valueFormatter}
          compact={chart.compact}
          ariaLabel={`${chart.title}占比环形图`}
        />
      );
      break;
    case "meter":
      bodyNode = (
        <CarbonMeterChart
          value={tile.meter?.value ?? 0}
          total={tile.meter?.total ?? 0}
          label={tile.meter?.label ?? "已用"}
          valueFormatter={valueFormatter}
          compact={chart.compact}
          ariaLabel={`${chart.title}占用仪表图`}
        />
      );
      break;
    case "number":
      bodyNode = <CarbonNumberGrid items={tile.numbers ?? []} />;
      break;
    case "table":
      bodyNode = <ChartInfoRows rows={tile.rows ?? []} label={chart.title} />;
      break;
    case "custom":
      bodyNode = <>{tile.node}</>;
      break;
    default:
      bodyNode = (
        <CarbonTimeSeriesChart
          series={tile.series ?? []}
          visualization={chart.visualization === "area" ? "area" : "line"}
          maxValue={tile.maxValue}
          valueFormatter={tile.valueFormatter}
          compact={chart.compact}
          onHoverPoint={setHoveredPoint}
        />
      );
      break;
  }

  return (
    <ChartTile
      title={tile.title ?? chart.title}
      subtitle={tile.subtitle}
      heroStat={displayHeroStat}
      heroBadge={displayHeroBadge}
      controls={tile.controls}
      emptyMessage={tile.emptyMessage}
      footer={tile.footer}
      details={tile.series?.length ? <ChartDetails series={tile.series} valueFormatter={tile.valueFormatter} /> : undefined}
    >
      {bodyNode}
    </ChartTile>
  );
}
