import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SamplePoint } from "@dsc/shared";
import { Icon } from "../m3e/icons";
import { dateValueOf } from "./sampleTime.ts";
import { chartGestureDirection, chartTimeAtClientX, indexChartSamples, inspectChartTime, latestChartValues, nearestChartTime, type ChartGestureDirection, type ChartInspection } from "./chartInspection.ts";
export type { ChartInspection } from "./chartInspection.ts";
import {
  chartAnimationsEnabled,
  partsFingerprint,
  prefersReducedMotion,
  seriesFingerprint
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
  if (!span || !Number.isFinite(span.min) || !Number.isFinite(span.max)) {
    const now = Date.now();
    return { min: now - 60_000, max: now, span: 60_000 };
  }
  if (span.max <= span.min) return { min: span.min - 30_000, max: span.min + 30_000, span: 60_000 };
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
  onHoverPoint?: (info: ChartInspection | null) => void;
  /** Device cards place the same readout in their header. */
  hideReadout?: boolean;
  readoutId?: string;
}

function ChartReadingValue({ text }: { text: string }) {
  const parts = /^(-?[\d.,]+)(\s*[%°℃A-Za-z].*)$/.exec(text);
  return parts ? <>{parts[1]}<span className="m3e-chart-readout__unit">{parts[2]}</span></> : <>{text}</>;
}

const sampleTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The one spelling of a sample instant, shared by the readout and the card's detail sheet. */
export function formatSampleTime(timestamp: number): string {
  return sampleTimeFormatter.format(new Date(timestamp));
}

/** Curve colours by series position, so a detail table can echo the chart's swatches. */
export function chartSeriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Latest or inspected reading. `compact` is the device-card form: the numbers lead
 * and the sample time trails on the same row; a lone curve drops its visible label
 * because the card title already names it.
 */
export function ChartReadout({ info, inspecting = false, id, compact = false }: { info: ChartInspection | null; inspecting?: boolean; id?: string; compact?: boolean }) {
  if (!info) return null;
  const hideLabel = compact && info.values.length === 1;
  const time = (
    <div className="m3e-chart-readout__time">
      <span>{inspecting ? "查点" : "最新"}</span>
      <time dateTime={new Date(info.timestamp).toISOString()}>{formatSampleTime(info.timestamp)}</time>
    </div>
  );
  return (
    <div className={`m3e-chart-readout${compact ? " is-compact" : ""}${inspecting ? " is-inspecting" : ""}`} id={id}>
      {compact ? null : time}
      <dl className="m3e-chart-readout__values">
        {info.values.map((item, index) => (
          <div key={`${index}-${item.label}`}>
            <dt className={hideLabel ? "m3e-visually-hidden" : undefined}><span className="m3e-chart__swatch" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} aria-hidden="true" />{item.label}</dt>
            <dd><ChartReadingValue text={item.valueText} /></dd>
          </div>
        ))}
      </dl>
      {compact ? time : null}
    </div>
  );
}

export function TimeSeriesChart({
  series,
  visualization = "line",
  maxValue,
  valueFormatter,
  ariaLabel,
  compact = false,
  className = "",
  onHoverPoint,
  hideReadout = false,
  readoutId
}: TimeSeriesChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const generatedReadoutId = useId();
  const fingerprint = useMemo(() => seriesFingerprint(series), [series]);
  const stableSeries = useMemo(() => series, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const index = useMemo(() => indexChartSamples(stableSeries), [stableSeries]);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const animations = chartAnimationsEnabled(reducedMotion);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const gesture = useRef<{ pointerId: number; x: number; y: number; direction: ChartGestureDirection } | null>(null);
  const callback = useRef(onHoverPoint);
  callback.current = onHoverPoint;

  const inspection = useMemo(() => selectedTime != null && index.timeline.includes(selectedTime)
    ? inspectChartTime(series, index, selectedTime, valueFormatter) : null, [series, index, selectedTime, valueFormatter]);
  const latest = useMemo(() => latestChartValues(series, index, valueFormatter), [series, index, valueFormatter]);
  useEffect(() => { callback.current?.(inspection); }, [inspection]);
  useEffect(() => {
    if (selectedTime != null && !index.timeline.includes(selectedTime)) setSelectedTime(null);
  }, [index, selectedTime]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setSelectedTime(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); callback.current?.(null); };
  }, [ref]);

  const height = compact ? 168 : 208;
  const hasData = index.timeline.length > 0;
  const svgWidth = Math.max(width, 240);
  const time = useMemo(() => timeScale(index.timeline.length ? { min: index.timeline[0], max: index.timeline[index.timeline.length - 1] } : null), [index]);
  const value = useMemo(() => linearScale(stableSeries.flatMap((item) => item.points.map((point) => point.value)), maxValue), [stableSeries, maxValue]);
  const tickFormatter = valueFormatter ?? series.find((item) => item.valueFormatter)?.valueFormatter;
  const xTicks = useMemo(() => niceTicks(time, svgWidth < 360 ? 2 : 3), [time, svgWidth]);
  const yTicks = useMemo(() => niceTicks(value, 3), [value]);
  const tickText = (tick: number) => tickFormatter ? tickFormatter(tick) : String(Math.round(tick));
  const padding = { top: 12, right: 14, bottom: 26, left: Math.max(44, Math.min(112, Math.max(...yTicks.map((tick) => tickText(tick).length)) * 6 + 12)) };
  const plotWidth = Math.max(1, svgWidth - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const toX = (timestamp: number) => padding.left + ((timestamp - time.min) / time.span) * plotWidth;
  const toY = (sample: number) => padding.top + plotHeight - ((sample - value.min) / value.span) * plotHeight;

  const inspectPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const target = chartTimeAtClientX(event.clientX, bounds, svgWidth, padding.left, padding.right, time.min, time.max);
    setSelectedTime(nearestChartTime(index.timeline, target));
  };
  const clearInspection = () => setSelectedTime(null);
  const hoverX = inspection ? toX(inspection.timestamp) : 0;

  // The measured host stays mounted while data is empty or loading. Its observer
  // therefore also measures the first SVG after an asynchronous response.
  return (
    <div ref={ref} className={`m3e-chart m3e-chart--${visualization}${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}>
      {!hasData ? <div className="m3e-chart-empty">{EMPTY_CHART_MESSAGE}</div> : <>
        {!hideReadout && <ChartReadout info={inspection ?? latest} inspecting={Boolean(inspection)} id={generatedReadoutId} />}
        <svg
          className={`m3e-chart__svg${keyboardFocus ? " is-keyboard-focus" : ""}`}
          width="100%"
          height={height}
          viewBox={`0 0 ${svgWidth} ${height}`}
          role="img"
          aria-label={ariaLabel ?? `指标时间趋势图：${stableSeries.map((item) => item.label).join("、")}`}
          aria-describedby={readoutId ?? (!hideReadout ? generatedReadoutId : undefined)}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape"
          tabIndex={0}
          onFocus={(event) => setKeyboardFocus(event.currentTarget.matches(":focus-visible"))}
          onBlur={() => { setKeyboardFocus(false); clearInspection(); }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") { inspectPointer(event); return; }
            const active = gesture.current;
            if (!active || active.pointerId !== event.pointerId) return;
            active.direction = chartGestureDirection(active.direction, event.clientX - active.x, event.clientY - active.y);
            if (active.direction === "vertical") { clearInspection(); return; }
            if (active.direction === "horizontal") {
              event.preventDefault();
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
              inspectPointer(event);
            }
          }}
          onPointerDown={(event) => {
            setKeyboardFocus(false);
            if (event.pointerType === "mouse") return;
            // A second finger belongs to pinch zoom, not chart inspection.
            if (gesture.current) { gesture.current = null; clearInspection(); return; }
            gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, direction: "pending" };
          }}
          onPointerUp={(event) => {
            const active = gesture.current;
            if (active?.pointerId !== event.pointerId) return;
            if (active.direction !== "vertical") inspectPointer(event);
            gesture.current = null;
          }}
          onPointerCancel={() => { gesture.current = null; clearInspection(); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") clearInspection(); }}
          onKeyDown={(event) => {
            setKeyboardFocus(true);
            if (event.key === "Escape") { clearInspection(); return; }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const position = selectedTime == null ? index.timeline.length - 1 : index.timeline.indexOf(selectedTime);
            const next = event.key === "Home" ? 0 : event.key === "End" ? index.timeline.length - 1
              : Math.max(0, Math.min(index.timeline.length - 1, position + (event.key === "ArrowLeft" ? -1 : 1)));
            setSelectedTime(index.timeline[next]);
          }}
        >
          {yTicks.map((tick) => {
            const y = toY(tick);
            return <g key={`y-${tick}`}>
              <line className="m3e-chart__grid" x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} />
              <text className="m3e-chart__axis" x={padding.left - 8} y={y + 4} textAnchor="end">{tickText(tick)}</text>
            </g>;
          })}
          {xTicks.map((tick, position) => <text key={`x-${position}`} className="m3e-chart__axis" x={toX(tick)} y={height - 6} textAnchor={position === 0 ? "start" : position === xTicks.length - 1 ? "end" : "middle"}>{formatClock(tick)}</text>)}
          {stableSeries.map((item, position) => {
            const color = CHART_COLORS[position % CHART_COLORS.length];
            const points = [...index.points[position]].sort(([a], [b]) => a - b).map(([timestamp, point]) => ({ x: toX(timestamp), y: toY(point.value) }));
            if (!points.length) return null;
            if (visualization === "bar") {
              const barWidth = Math.max(2, Math.min(18, plotWidth / points.length - 3));
              return <g key={item.label} fill={color}>{points.map((point, barIndex) => <rect key={barIndex} x={point.x - barWidth / 2} y={point.y} width={barWidth} height={Math.max(0, padding.top + plotHeight - point.y)} rx={Math.min(barWidth / 2, 4)}>
                {animations && <animate attributeName="opacity" from="0" to="1" dur="220ms" fill="freeze" />}
              </rect>)}</g>;
            }
            return <g key={item.label} className="m3e-chart__series" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              {visualization === "area" && <path d={buildAreaPath(points, padding.top + plotHeight)} fill={color} opacity="0.16" stroke="none" />}
              <path d={buildLinePath(points)} />
              {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="3" fill={color} stroke="none" />}
            </g>;
          })}
          {inspection && <g className="m3e-chart__hover" aria-hidden="true">
            <line x1={hoverX} y1={padding.top} x2={hoverX} y2={padding.top + plotHeight} />
            {inspection.values.map((item, position) => item.point ? <circle key={`${position}-${item.label}`} cx={hoverX} cy={toY(item.point.value)} r="4" fill={CHART_COLORS[position % CHART_COLORS.length]} /> : null)}
          </g>}
        </svg>
      </>}
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
  const size = compact ? 144 : 160;
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
  const width = 240;
  const height = 138;
  const radius = 84;
  const circumference = Math.PI * radius;
  const color = statusRanges?.find((range) => safeValue >= range.range[0] && safeValue <= range.range[1])?.status;

  return (
    <div className={`m3e-chart m3e-chart--meter${className ? ` ${className}` : ""}`}>
      <svg width={compact ? 168 : 192} height={compact ? 97 : 110} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
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
