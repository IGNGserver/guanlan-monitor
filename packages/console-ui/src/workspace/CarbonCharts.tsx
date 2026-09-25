import React, { useMemo } from "react";
import { AreaChart, DonutChart, LineChart, MeterChart, SimpleBarChart } from "@carbon/charts-react";
import type {
  AreaChartOptions,
  BarChartOptions,
  ChartTabularData,
  DonutChartOptions,
  LineChartOptions,
  MeterChartOptions
} from "@carbon/charts-react";
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

function axisOptions(height: string, series: CarbonSeries[]) {
  const valueFormatter = series.find((item) => item.valueFormatter)?.valueFormatter;
  const formatTick = (tick: number | Date) => typeof tick === "number" && Number.isFinite(tick)
    ? valueFormatter?.(tick) ?? String(tick)
    : String(tick);
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
        scaleType: "linear",
        ticks: valueFormatter ? { formatter: formatTick } : undefined
      }
    },
    curve: "curveMonotoneX",
    points: { enabled: false },
    legend: { enabled: series.length > 1 },
    toolbar: { enabled: false },
    tooltip: { enabled: true, valueFormatter: valueFormatter ? (value: unknown) => typeof value === "number" ? valueFormatter(value) : String(value) : undefined },
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
  const options = axisOptions(height, series);
  const wrapperClassName = `telemetry-carbon-chart${compact ? " telemetry-carbon-chart--compact" : ""}${className ? ` ${className}` : ""}`;

  if (visualization === "area") {
    return <div className={wrapperClassName}><AreaChart data={data} options={options as AreaChartOptions} /></div>;
  }
  if (visualization === "bar") {
    return <div className={wrapperClassName}><SimpleBarChart data={data} options={options as BarChartOptions} /></div>;
  }
  return <div className={wrapperClassName}><LineChart data={data} options={options as LineChartOptions} /></div>;
}

/** 占比图的一个分片。value 必须是同单位的绝对量，比例由图表自行计算。 */
export type CarbonDonutPart = { label: string; value: number };

/** 仪表图的状态区间；status 取 Carbon 的 success / warning / danger。 */
export type CarbonMeterStatusRange = { range: [number, number]; status: string };

/** 数值读数网格的一项，取代原先手绘的 NumberView。 */
export type CarbonNumberItem = { label: string; value: string; hint?: string };

const EMPTY_CHART_MESSAGE = "当前时间范围没有可用数据";

function donutData(parts: CarbonDonutPart[]): ChartTabularData {
  return parts
    .filter((part) => Number.isFinite(part.value) && part.value >= 0)
    .map((part) => ({ group: part.label, value: part.value }));
}

function chartWrapperClassName(kind: string, compact: boolean, className: string) {
  return `telemetry-carbon-chart telemetry-carbon-chart--${kind}${compact ? " telemetry-carbon-chart--compact" : ""}${className ? ` ${className}` : ""}`;
}

/**
 * Carbon 环形图，用于容量占比。
 *
 * 圆心默认显示第一个分片占总量的百分比；传入 `centerValue` 时改为显示该绝对量，
 * 并用 `valueFormatter` 格式化。
 */
export function CarbonDonutChart({
  parts,
  centerLabel,
  centerValue,
  valueFormatter = (value) => String(Math.round(value)),
  compact = false,
  className = "",
  ariaLabel = "容量占比环形图"
}: {
  parts: CarbonDonutPart[];
  centerLabel?: string;
  centerValue?: number;
  valueFormatter?: (value: number) => string;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const data = useMemo(() => donutData(parts), [parts]);
  if (!data.length) return <div className={`telemetry-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;

  const total = data.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0);
  const firstValue = typeof data[0].value === "number" ? data[0].value : 0;
  const showPercentage = centerValue == null;
  const options: DonutChartOptions = {
    height: compact ? "168px" : "208px",
    theme: chartTheme(),
    animations: true,
    resizable: true,
    legend: { enabled: data.length > 1, position: "bottom" },
    toolbar: { enabled: false },
    tooltip: { enabled: true, valueFormatter: (value: number) => valueFormatter(value) },
    pie: { alignment: "center" },
    donut: {
      center: {
        label: centerLabel,
        number: showPercentage ? (total > 0 ? (firstValue / total) * 100 : 0) : centerValue,
        numberFormatter: showPercentage ? (value) => `${Math.round(value)}%` : (value) => valueFormatter(value)
      }
    },
    accessibility: { svgAriaLabel: ariaLabel }
  };

  return (
    <div className={chartWrapperClassName("donut", compact, className)}>
      <DonutChart data={data} options={options} />
    </div>
  );
}

/**
 * Carbon 仪表图，用于「已用 / 总量」这类单值占比。
 *
 * 与环形图的区别是它保留线性刻度，适合放在密集网格里做快速扫读。
 */
export function CarbonMeterChart({
  value,
  total,
  label = "已用",
  valueFormatter = (item) => String(Math.round(item)),
  statusRanges,
  compact = false,
  className = "",
  ariaLabel = "容量占用仪表图"
}: {
  value: number;
  total: number;
  label?: string;
  valueFormatter?: (value: number) => string;
  statusRanges?: CarbonMeterStatusRange[];
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.max(total, safeValue) : Math.max(safeValue, 1);
  const data: ChartTabularData = [{ group: label, value: safeValue }];
  const options: MeterChartOptions = {
    height: compact ? "72px" : "96px",
    theme: chartTheme(),
    animations: true,
    resizable: true,
    legend: { enabled: false },
    toolbar: { enabled: false },
    tooltip: { enabled: true, valueFormatter: (item: number) => valueFormatter(item) },
    meter: {
      showLabels: true,
      proportional: {
        total: safeTotal,
        totalFormatter: (item) => valueFormatter(item)
      },
      ...(statusRanges?.length ? { status: { ranges: statusRanges } } : {})
    },
    accessibility: { svgAriaLabel: ariaLabel }
  };

  return (
    <div className={chartWrapperClassName("meter", compact, className)}>
      <MeterChart data={data} options={options} />
    </div>
  );
}

/**
 * 数值读数网格，用于「只要当前值、不需要趋势」的指标。
 *
 * 这是纯排版组件，不走 Carbon Charts：读数没有可绘制的量纲，硬塞进图表反而
 * 会引入无意义的坐标轴。
 */
export function CarbonNumberGrid({ items, className = "" }: { items: CarbonNumberItem[]; className?: string }) {
  if (!items.length) return <div className={`telemetry-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;
  return (
    <div className={`carbon-number-grid${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <div className="carbon-number-grid__cell" key={item.label}>
          <span className="carbon-number-grid__label">{item.label}</span>
          <strong className="carbon-number-grid__value">{item.value}</strong>
          {item.hint ? <span className="carbon-number-grid__hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

