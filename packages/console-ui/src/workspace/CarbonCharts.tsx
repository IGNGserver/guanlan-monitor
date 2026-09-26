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

/**
 * Axis ticks are formatted here rather than left to Carbon Charts.
 *
 * Carbon Charts formats a `scaleType: "time"` axis with the browser locale, so
 * an English browser rendered `9:56:30 AM` on a page whose every other
 * timestamp is `9月26日 08:13` — and the CI runner, pinned to `en-US`, was
 * quietly asserting against the English form. This is the same `zh-CN` 24-hour
 * contract `formatAxisTime` gives the rest of the console, so the axis can no
 * longer drift with whoever is looking at it.
 */
const axisTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatAxisTickDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? axisTimeFormatter.format(date) : "";
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

function axisOptions(height: string, series: CarbonSeries[], maxValue?: number, valueFormatter?: (value: number) => string) {
  /* A tile can carry one formatter for all of its series; that is the common
     case here (`PERCENT_TILE`). Falling back to the first series that declares
     one used to be the only path, so every percentage tile whose series did
     not repeat the formatter rendered a bare `10 … 60` with no unit, and you
     had to read the card title to learn it was a utilisation percentage. */
  const tickFormatter = valueFormatter ?? series.find((item) => item.valueFormatter)?.valueFormatter
    ?? (maxValue === 100 ? (value: number) => `${Math.round(value)}%` : undefined);
  const formatTick = (tick: number | Date) => typeof tick === "number" && Number.isFinite(tick)
    ? tickFormatter?.(tick) ?? String(tick)
    : formatAxisTickDate(tick);
  return {
    height,
    theme: chartTheme(),
    animations: true,
    resizable: true,
    axes: {
      bottom: {
        title: "时间",
        mapsTo: "date",
        scaleType: "time",
        ticks: { formatter: formatTick }
      },
      left: {
        title: "",
        mapsTo: "value",
        scaleType: "linear",
        ticks: tickFormatter ? { formatter: formatTick } : undefined,
        // 百分比这类有天然上界的指标必须钉住坐标轴，否则 3% 的抖动会被拉满
        // 整个绘图区，看起来像满载。
        ...(maxValue == null ? {} : { max: maxValue })
      }
    },
    curve: "curveMonotoneX",
    points: { enabled: false },
    legend: { enabled: series.length > 1 },
    toolbar: { enabled: false },
    tooltip: { enabled: true, valueFormatter: tickFormatter ? (value: unknown) => typeof value === "number" ? tickFormatter(value) : String(value) : undefined },
    accessibility: { svgAriaLabel: timeSeriesAriaLabel(series) }
  };
}

/**
 * A time-series chart used to announce itself as `硬件指标时间趋势图` no matter
 * what it plotted, so a screen-reader user on the device page heard the same
 * phrase over a dozen different charts with no way to tell CPU frequency from
 * disk temperature. The series labels are already specific, so they become the
 * distinguishing part of the name by default; `ariaLabel` overrides it where a
 * caller has something better.
 */
function timeSeriesAriaLabel(series: CarbonSeries[], ariaLabel?: string): string {
  if (ariaLabel) return ariaLabel;
  const labels = series.map((item) => item.label).filter(Boolean);
  return labels.length
    ? `硬件指标时间趋势图：${labels.join("、")}`
    : "硬件指标时间趋势图";
}

export function CarbonTimeSeriesChart({
  series,
  visualization = "line",
  maxValue,
  valueFormatter,
  ariaLabel,
  compact = false,
  className = ""
}: {
  series: CarbonSeries[];
  visualization?: "line" | "area" | "bar";
  /** 钉住纵轴上界，用于百分比这类有天然上界的指标。 */
  maxValue?: number;
  /** 整个磁贴共用的读数格式，纵轴刻度与浮层都走它。 */
  valueFormatter?: (value: number) => string;
  /** 读屏用的图表名；缺省时由序列标签拼出，保证每张图名字不同。 */
  ariaLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const data = useMemo(() => carbonChartData(series), [series]);
  const options = useMemo(
    () => axisOptions(compact ? "128px" : "248px", series, maxValue, valueFormatter),
    [compact, series, maxValue, valueFormatter]
  );
  if (!data.length) return <div className={`telemetry-empty ${className}`}>当前时间范围没有可用数据</div>;

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

