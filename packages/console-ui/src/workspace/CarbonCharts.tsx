import React, { useMemo } from "react";
import { AreaChart, LineChart, SimpleBarChart } from "@carbon/charts-react";
import type { AreaChartOptions, BarChartOptions, ChartTabularData, LineChartOptions } from "@carbon/charts-react";
import type { SamplePoint } from "@dsc/shared";

export type CarbonSeries = {
  label: string;
  points: SamplePoint[];
  valueFormatter?: (value: number) => string;
};

function chartTheme(): "g10" | "g100" {
  if (typeof document === "undefined") return "g10";
  return document.documentElement.dataset.dscResolvedTheme === "dark" ? "g100" : "g10";
}

export function carbonChartData(series: CarbonSeries[]): ChartTabularData {
  return series.flatMap((item) => item.points
    .filter((point) => Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value))
    .map((point) => ({
      group: item.label,
      date: new Date(point.timestamp),
      value: point.value
    })));
}

function axisOptions(height: string, seriesCount: number) {
  return {
    height,
    theme: chartTheme(),
    animations: true,
    resizable: true,
    axes: {
      bottom: {
        title: "时间",
        mapsTo: "date",
        scaleType: "time"
      },
      left: {
        title: "",
        mapsTo: "value",
        scaleType: "linear"
      }
    },
    curve: "curveMonotoneX",
    points: { enabled: false },
    legend: { enabled: seriesCount > 1 },
    toolbar: { enabled: false },
    tooltip: { enabled: true },
    accessibility: { svgAriaLabel: "硬件指标时间趋势图" }
  };
}

export function CarbonTimeSeriesChart({
  series,
  visualization = "line",
  compact = false,
  className = ""
}: {
  series: CarbonSeries[];
  visualization?: "line" | "area" | "bar";
  compact?: boolean;
  className?: string;
}) {
  const data = useMemo(() => carbonChartData(series), [series]);
  if (!data.length) return <div className={`telemetry-empty ${className}`}>当前时间范围没有可用数据</div>;

  const height = compact ? "128px" : "248px";
  const options = axisOptions(height, series.length);
  const wrapperClassName = `telemetry-carbon-chart${compact ? " telemetry-carbon-chart--compact" : ""}${className ? ` ${className}` : ""}`;

  if (visualization === "area") {
    return <div className={wrapperClassName}><AreaChart data={data} options={options as AreaChartOptions} /></div>;
  }
  if (visualization === "bar") {
    return <div className={wrapperClassName}><SimpleBarChart data={data} options={options as BarChartOptions} /></div>;
  }
  return <div className={wrapperClassName}><LineChart data={data} options={options as LineChartOptions} /></div>;
}
