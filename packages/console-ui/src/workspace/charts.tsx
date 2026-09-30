import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SamplePoint } from "@dsc/shared";
import { Icon } from "../m3e/icons";
import { dateValueOf } from "./sampleTime.ts";
import {
  chartAnimationsEnabled,
  partsFingerprint,
  prefersReducedMotion,
  seriesFingerprint,
  seriesTimeSpan
} from "./chartIdentity.ts";

/* =============================================================================
 * Material 3 Expressive charts.
 *
 * Pure SVG + React with zero external chart runtime.
 * The memoisation and reduced motion contracts are defined in chartIdentity.ts.
 * ========================================================================== */

export type ChartSeries = {
  label: string;
  points: SamplePoint[];
  valueFormatter?: (value: number) => string;
};

export type ChartPart = { label: string; value: number };
export type ChartNumberItem = { label: string; value: string; hint?: string };
export type ChartMeterStatusRange = { range: [number, number]; status: "success" | "warning" | "danger" | "info" };

export type ChartVisualization = "line" | "area" | "bar";

const CHART_COLORS = [
  "var(--md-sys-color-accent-1)",
  "var(--md-sys-color-accent-2)",
  "var(--md-sys-color-accent-3)",
  "var(--md-sys-color-accent-4)",
  "var(--md-sys-color-accent-5)"
];

const EMPTY_CHART_MESSAGE = "当前时间范围没有可用数据";

/* ---- Responsive width ------------------------------------------------------ */

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/* ---- Scales ---------------------------------------------------------------- */

type Scale = { min: number; max: number; span: number };

function linearScale(values: number[], pinnedMax?: number): Scale {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)) { min = 0; max = pinnedMax ?? 1; }
  min = Math.min(0, min);
  if (pinnedMax != null) max = pinnedMax;
  if (max <= min) max = min + 1;
  return { min, max, span: max - min };
}

function timeScale(span: { min: number; max: number } | null): Scale {
  if (!span || !Number.isFinite(span.min) || !Number.isFinite(span.max) || span.max <= span.min) {
    const now = Date.now();
    return { min: now - 60_000, max: now, span: 60_000 };
  }
  return { min: span.min, max: span.max, span: span.max - span.min };
}

/* ---- Path helpers ---------------------------------------------------------- */

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  // Catmull-Rom → cubic Bézier, clamped so the curve stays near the samples.
  let d = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baseline: number): string {
  if (!points.length) return "";
  return `${buildLinePath(points)}L${points[points.length - 1].x} ${baseline}L${points[0].x} ${baseline}Z`;
}

function niceTicks(scale: Scale, count: number): number[] {
  const step = scale.span / count;
  return Array.from({ length: count + 1 }, (_, index) => scale.min + step * index);
}

/* ---- Time series ----------------------------------------------------------- */

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  visualization?: ChartVisualization;
  maxValue?: number;
  valueFormatter?: (value: number) => string;
  ariaLabel?: string;
  compact?: boolean;
  className?: string;
  onHoverPoint?: (info: { timeText: string; valueText: string } | null) => void;
}

export function TimeSeriesChart({
  series,
  visualization = "line",
  maxValue,
  valueFormatter,
  ariaLabel,
  compact = false,
  className = "",
  onHoverPoint
}: TimeSeriesChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const fingerprint = useMemo(() => seriesFingerprint(series), [series]);
  const stableSeries = useMemo(() => series, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const animations = chartAnimationsEnabled(reducedMotion);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const height = compact ? 132 : 248;
  const hasData = stableSeries.some((item) => item.points.length > 0);
  const svgWidth = Math.max(width, 240);
  const padding = { top: 12, right: 14, bottom: 26, left: 46 };
  const plotWidth = Math.max(1, svgWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);

  const time = useMemo(() => timeScale(seriesTimeSpan(stableSeries)), [stableSeries]);
  const value = useMemo(() => linearScale(stableSeries.flatMap((item) => item.points.map((point) => point.value)), maxValue), [stableSeries, maxValue]);
  const tickFormatter = valueFormatter ?? stableSeries.find((item) => item.valueFormatter)?.valueFormatter;

  const toX = (timestamp: number) => padding.left + ((timestamp - time.min) / time.span) * plotWidth;
  const toY = (value01: number) => padding.top + plotHeight - ((value01 - value.min) / value.span) * plotHeight;

  const xTicks = useMemo(() => niceTicks(time, 3), [time]);
  const yTicks = useMemo(() => niceTicks(value, 3), [value]);
  const primary = stableSeries.find((item) => item.points.length) ?? stableSeries[0];

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!primary?.points.length || !onHoverPoint) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left - padding.left) / plotWidth;
    const target = time.min + Math.max(0, Math.min(1, ratio)) * time.span;
    let best = 0;
    let bestDelta = Infinity;
    primary.points.forEach((point, index) => {
      const delta = Math.abs(dateValueOf(point.timestamp) - target);
      if (delta < bestDelta) { bestDelta = delta; best = index; }
    });
    setHoverIndex(best);
    const point = primary.points[best];
    onHoverPoint({ timeText: formatClock(point.timestamp), valueText: (primary.valueFormatter ?? tickFormatter ?? String)(point.value) });
  };

  const clearHover = () => {
    setHoverIndex(null);
    onHoverPoint?.(null);
  };

  if (!hasData) return <div className={`m3e-chart-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;

  const hoverPoint = hoverIndex != null ? primary?.points[hoverIndex] : undefined;
  const hoverX = hoverPoint ? toX(dateValueOf(hoverPoint.timestamp)) : 0;

  return (
    <div ref={ref} className={`m3e-chart m3e-chart--${visualization}${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}>
      <svg
        className="m3e-chart__svg"
        width="100%"
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        role="img"
        aria-label={ariaLabel ?? `指标时间趋势图：${stableSeries.map((item) => item.label).join("、")}`}
        onPointerMove={onHoverPoint ? handlePointerMove : undefined}
        onPointerLeave={onHoverPoint ? clearHover : undefined}
      >
        {/* horizontal grid + value axis */}
        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={`y-${tick}`}>
              <line className="m3e-chart__grid" x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} />
              <text className="m3e-chart__axis" x={padding.left - 8} y={y + 4} textAnchor="end">{tickFormatter ? tickFormatter(tick) : Math.round(tick)}</text>
            </g>
          );
        })}
        {/* time axis */}
        {xTicks.map((tick, index) => {
          const x = toX(tick);
          return (
            <text key={`x-${index}`} className="m3e-chart__axis" x={x} y={height - 6} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}>
              {formatClock(tick)}
            </text>
          );
        })}
        {/* series */}
        {stableSeries.map((item, index) => {
          const color = CHART_COLORS[index % CHART_COLORS.length];
          const points = item.points
            .filter((point) => Number.isFinite(dateValueOf(point.timestamp)) && Number.isFinite(point.value))
            .map((point) => ({ x: toX(dateValueOf(point.timestamp)), y: toY(point.value) }));
          if (!points.length) return null;
          if (visualization === "bar") {
            const barWidth = Math.max(2, Math.min(18, plotWidth / Math.max(1, points.length) - 3));
            return (
              <g key={item.label} fill={color}>
                {points.map((point, barIndex) => (
                  <rect
                    key={barIndex}
                    x={point.x - barWidth / 2}
                    y={point.y}
                    width={barWidth}
                    height={Math.max(0, padding.top + plotHeight - point.y)}
                    rx={Math.min(barWidth / 2, 4)}
                  >
                    {animations ? <animate attributeName="opacity" from="0" to="1" dur="220ms" fill="freeze" /> : null}
                  </rect>
                ))}
              </g>
            );
          }
          return (
            <g key={item.label} className="m3e-chart__series" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              {visualization === "area" ? <path d={buildAreaPath(points, padding.top + plotHeight)} fill={color} opacity="0.16" stroke="none" /> : null}
              <path d={buildLinePath(points)} />
            </g>
          );
        })}
        {/* hover */}
        {hoverPoint ? (
          <g className="m3e-chart__hover">
            <line x1={hoverX} y1={padding.top} x2={hoverX} y2={padding.top + plotHeight} />
            {stableSeries.map((item, index) => {
              const point = item.points[hoverIndex ?? -1];
              if (!point) return null;
              return <circle key={item.label} cx={toX(dateValueOf(point.timestamp))} cy={toY(point.value)} r="4" fill={CHART_COLORS[index % CHART_COLORS.length]} />;
            })}
          </g>
        ) : null}
      </svg>
      {stableSeries.length > 1 ? (
        <ul className="m3e-chart__legend">
          {stableSeries.map((item, index) => (
            <li key={item.label}><span className="m3e-chart__swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} aria-hidden="true" />{item.label}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---- Donut ----------------------------------------------------------------- */

export interface DonutChartProps {
  parts: ChartPart[];
  centerLabel?: string;
  centerValue?: number;
  valueFormatter?: (value: number) => string;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function DonutChart({
  parts,
  centerLabel,
  centerValue,
  valueFormatter = (value) => String(Math.round(value)),
  compact = false,
  className = "",
  ariaLabel = "容量占比环形图"
}: DonutChartProps) {
  const fingerprint = useMemo(() => partsFingerprint(parts), [parts]);
  const stable = useMemo(() => parts, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = compact ? 168 : 200;
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const valid = stable.filter((part) => Number.isFinite(part.value) && part.value >= 0);
  const total = valid.reduce((sum, part) => sum + part.value, 0);
  if (!valid.length || total <= 0) return <div className={`m3e-chart-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;
  const showPercent = centerValue == null;

  let offset = 0;
  return (
    <div className={`m3e-chart m3e-chart--donut${className ? ` ${className}` : ""}`}>
      <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={ariaLabel}>
        <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--md-sys-color-surface-container-highest)" strokeWidth="22" />
        {valid.map((part, index) => {
          const fraction = part.value / total;
          const dash = fraction * circumference;
          const segment = (
            <circle
              key={part.label}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth="22"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 100 100)"
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return segment;
        })}
        <text className="m3e-chart__donut-value" x="100" y="98" textAnchor="middle">{showPercent ? `${Math.round((valid[0].value / total) * 100)}%` : valueFormatter(centerValue as number)}</text>
        {centerLabel ? <text className="m3e-chart__donut-label" x="100" y="122" textAnchor="middle">{centerLabel}</text> : null}
      </svg>
      <ul className="m3e-chart__legend m3e-chart__legend--stacked">
        {valid.map((part, index) => (
          <li key={part.label}><span className="m3e-chart__swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} aria-hidden="true" />{part.label}<strong>{valueFormatter(part.value)}</strong></li>
        ))}
      </ul>
    </div>
  );
}

/* ---- Meter ----------------------------------------------------------------- */

export interface MeterChartProps {
  value: number;
  total: number;
  label?: string;
  valueFormatter?: (value: number) => string;
  statusRanges?: ChartMeterStatusRange[];
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function MeterChart({
  value,
  total,
  label = "已用",
  valueFormatter = (item) => String(Math.round(item)),
  statusRanges,
  compact = false,
  className = "",
  ariaLabel = "容量占用仪表图"
}: MeterChartProps) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.max(total, safeValue) : Math.max(safeValue, 1);
  const percent = Math.min(1, safeValue / safeTotal);
  const width = compact ? 180 : 240;
  const height = compact ? 84 : 108;
  const radius = 84;
  const circumference = Math.PI * radius;
  const color = statusRanges?.find((range) => safeValue >= range.range[0] && safeValue <= range.range[1])?.status;

  return (
    <div className={`m3e-chart m3e-chart--meter${className ? ` ${className}` : ""}`}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <path d={`M${width / 2 - radius} ${height - 12} A ${radius} ${radius} 0 0 1 ${width / 2 + radius} ${height - 12}`} fill="none" stroke="var(--md-sys-color-surface-container-highest)" strokeWidth="16" strokeLinecap="round" />
        <path
          d={`M${width / 2 - radius} ${height - 12} A ${radius} ${radius} 0 0 1 ${width / 2 + radius} ${height - 12}`}
          fill="none"
          stroke={color === "danger" ? "var(--md-sys-color-error)" : color === "warning" ? "var(--md-sys-color-warning)" : "var(--md-sys-color-primary)"}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${percent * circumference} ${circumference}`}
        />
        <text className="m3e-chart__meter-value" x={width / 2} y={height - 24} textAnchor="middle">{valueFormatter(safeValue)}</text>
      </svg>
      <div className="m3e-chart__meter-caption"><span>{label}</span><strong>{Math.round(percent * 100)}%</strong></div>
    </div>
  );
}

/* ---- Number grid ----------------------------------------------------------- */

export function NumberGrid({ items, className = "" }: { items: ChartNumberItem[]; className?: string }) {
  if (!items.length) return <div className={`m3e-chart-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;
  return (
    <div className={`m3e-number-grid${className ? ` ${className}` : ""}`}>
      {items.map((item) => (
        <div className="m3e-number-grid__cell" key={item.label}>
          <span className="m3e-number-grid__label">{item.label}</span>
          <strong className="m3e-number-grid__value">{item.value}</strong>
          {item.hint ? <span className="m3e-number-grid__hint">{item.hint}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ---- Empty state ----------------------------------------------------------- */

export function ChartEmpty({ className = "" }: { className?: string }) {
  return <div className={`m3e-chart-empty ${className}`.trim()}>{EMPTY_CHART_MESSAGE}</div>;
}

/* ---- Formatting ------------------------------------------------------------ */

const clockFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayClockFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function formatClock(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return clockFormatter.format(date);
}

export function formatAxisTimeLabel(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dayClockFormatter.format(date);
}

export { Icon as ChartIcon };
