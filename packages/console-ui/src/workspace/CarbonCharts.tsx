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
import { ChartTouchGestureOverlay } from "./ChartTouchGestureOverlay.tsx";
import { dateValueOf } from "./sampleTime.ts";
import {
  chartAnimationsEnabled,
  partsFingerprint,
  prefersReducedMotion,
  seriesFingerprint,
  seriesTimeSpan
} from "./chartIdentity.ts";

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
 * Axis ticks are formatted dynamically based on time span and range.
 * Short windows (1m, 5m, 15m, 1h) display concise HH:mm so ticks don't overlap.
 * Longer windows include month and day.
 */
const timeOnlyFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const monthDayTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatAxisTickDate(value: unknown, isShortRange = true): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  return isShortRange ? timeOnlyFormatter.format(date) : monthDayTimeFormatter.format(date);
}

export function carbonChartData(series: CarbonSeries[]): ChartTabularData {
  return series.flatMap((item) => item.points
    .filter((point) => Number.isFinite(dateValueOf(point.timestamp)) && Number.isFinite(point.value))
    .map((point) => ({
      group: item.label,
      date: new Date(point.timestamp),
      value: point.value
    })));
}

/**
 * Charts animate their enter/update transitions. That is the right default for a
 * first paint, but this dashboard re-supplies data on every status poll, so
 * leaving it on means a d3 transition per chart per poll for values that moved by
 * a fraction of a pixel. Under reduced motion the transition is pointless; the
 * caller decides and the effect is sticky per chart instance so a re-render does
 * not restart an animation that is already settling.
 */

function axisOptions(
  height: string,
  series: CarbonSeries[],
  maxValue?: number,
  valueFormatter?: (value: number) => string,
  animations = true,
  ariaLabel?: string
) {
  const tickFormatter = valueFormatter ?? series.find((item) => item.valueFormatter)?.valueFormatter
    ?? (maxValue === 100 ? (value: number) => `${Math.round(value)}%` : undefined);

  // Compute time range duration to pick tick format
  let isShortRange = true;
  const span = seriesTimeSpan(series);
  if (span && span.max - span.min > 3600 * 6 * 1000) {
    isShortRange = false;
  }

  const formatTick = (tick: number | Date) => typeof tick === "number" && Number.isFinite(tick)
    ? tickFormatter?.(tick) ?? String(tick)
    : formatAxisTickDate(tick, isShortRange);

  return {
    height,
    theme: chartTheme(),
    animations,
    resizable: true,
    axes: {
      bottom: {
        title: "",
        mapsTo: "date",
        scaleType: "time",
        ticks: {
          formatter: formatTick,
          rotation: "never"
        }
      },
      left: {
        title: "",
        mapsTo: "value",
        scaleType: "linear",
        ticks: tickFormatter ? { formatter: formatTick } : undefined,
        // 百分比这类有天然上界的指标必须钉住坐标轴，否则 3% 的抖动会被拉满整个绘图区
        ...(maxValue == null ? {} : { max: maxValue })
      }
    },
    curve: "curveMonotoneX",
    points: { enabled: false },
    legend: { enabled: series.length > 1 },
    toolbar: { enabled: false },
    tooltip: { enabled: true, valueFormatter: tickFormatter ? (value: unknown) => typeof value === "number" ? tickFormatter(value) : String(value) : undefined },
    accessibility: { svgAriaLabel: timeSeriesAriaLabel(series, ariaLabel) }
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

/**
 * A time-series chart.
 *
 * The dashboard rebuilds each chart's `series` on every render, so a memo keyed
 * on the array identity never hits and every poll re-runs the point filtering and
 * axis-range scan. `seriesFingerprint` keys the memo on the actual values so a
 * poll whose data did not change skips that work; see `chartIdentity.ts`.
 */
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
  // Keyed on content, not identity: a poll that re-supplies identical points must
  // not rebuild the d3 data or the options object.
  const fingerprint = useMemo(() => seriesFingerprint(series), [series]);
  const stableSeries = useMemo(() => series, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const animations = chartAnimationsEnabled(reducedMotion);
  const data = useMemo(() => carbonChartData(stableSeries), [stableSeries]);
  const options = useMemo(
    () => axisOptions(compact ? "128px" : "248px", stableSeries, maxValue, valueFormatter, animations, ariaLabel),
    [compact, stableSeries, maxValue, valueFormatter, animations, ariaLabel]
  );
  if (!data.length) return <div className={`telemetry-empty ${className}`}>当前时间范围没有可用数据</div>;

  const wrapperClassName = `telemetry-carbon-chart${compact ? " telemetry-carbon-chart--compact" : ""}${className ? ` ${className}` : ""}`;

  let chartElement: React.ReactNode;
  if (visualization === "area") {
    chartElement = <AreaChart data={data} options={options as AreaChartOptions} />;
  } else if (visualization === "bar") {
    chartElement = <SimpleBarChart data={data} options={options as BarChartOptions} />;
  } else {
    chartElement = <LineChart data={data} options={options as LineChartOptions} />;
  }

  return (
    <div className={wrapperClassName}>
      <ChartTouchGestureOverlay>
        {chartElement}
      </ChartTouchGestureOverlay>
    </div>
  );
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
 *
 * `partsFingerprint` keys the options memo on the values, so a poll that changed
 * nothing does not rebuild them.
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
  const fingerprint = useMemo(() => partsFingerprint(parts), [parts]);  const stableParts = useMemo(() => parts, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => donutData(stableParts), [stableParts]);
  const animations = chartAnimationsEnabled(useMemo(prefersReducedMotion, []));
  const options = useMemo<DonutChartOptions>(() => {
    const total = data.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0);
    const firstValue = typeof data[0]?.value === "number" ? data[0].value as number : 0;
    const showPercentage = centerValue == null;
    return {
      height: compact ? "168px" : "208px",
      theme: chartTheme(),
      animations,
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
  }, [animations, ariaLabel, centerLabel, centerValue, compact, data, valueFormatter]);

  if (!data.length) return <div className={`telemetry-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;

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
  const animations = chartAnimationsEnabled(useMemo(prefersReducedMotion, []));
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.max(total, safeValue) : Math.max(safeValue, 1);
  const options = useMemo<MeterChartOptions>(() => ({
    height: compact ? "72px" : "96px",
    theme: chartTheme(),
    animations,
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
  }), [animations, ariaLabel, compact, safeTotal, statusRanges, valueFormatter]);
  const data: ChartTabularData = useMemo(() => [{ group: label, value: safeValue }], [label, safeValue]);

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

