import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SamplePoint } from "@dsc/shared";
import { Icon } from "../m3e/icons";
import { dateValueOf } from "./sampleTime.ts";
import { chartGestureDirection, chartTimeAtClientX, indexChartSamples, inspectChartTime, latestChartValues, nearestChartTime, type ChartGestureDirection, type ChartInspection } from "./chartInspection.ts";
export type { ChartInspection } from "./chartInspection.ts";
import { DAY, formatsBytes, gapThreshold, monotonePath, niceLinearAxis, niceTimeAxis, silentSpans, splitAtGaps } from "./chartGeometry.ts";
import {
  chartAnimationsEnabled,
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
  /** Drawn dashed: the series is history that is no longer being added to (an offline device). */
  dashed?: boolean;
};

/**
 * A horizontal reference drawn across the plot, such as the warning and critical
 * thresholds of a percentage. The same two tones colour status tags and issue
 * rows, so a curve crossing the line reads as the issue listed beside it.
 */
export type ChartThreshold = { value: number; tone: "warning" | "critical"; label?: string };

export type ChartNumberItem = { label: string; value: string; hint?: string };

export type ChartVisualization = "line" | "area" | "bar";

/**
 * Eight categorical slots, validated for colour-vision deficiency and contrast
 * on both chart surfaces (see the accent tokens). Hues are assigned by series
 * position and never cycled: a ninth series and beyond share one neutral
 * "other" ink rather than repeating a colour that already names a device.
 *
 * Orange, amber and red come last. They are also the warning and critical
 * colours of threshold lines and status tags, so a chart with two or three
 * curves — nearly every chart here — must not paint a healthy series in them.
 */
const CHART_COLORS = [
  "var(--md-sys-color-accent-1)",
  "var(--md-sys-color-accent-3)",
  "var(--md-sys-color-accent-7)",
  "var(--md-sys-color-accent-5)",
  "var(--md-sys-color-accent-6)",
  "var(--md-sys-color-accent-2)",
  "var(--md-sys-color-accent-4)",
  "var(--md-sys-color-accent-8)"
];
const CHART_OTHER_COLOR = "var(--md-sys-color-outline)";

function seriesColor(index: number): string {
  return CHART_COLORS[index] ?? CHART_OTHER_COLOR;
}

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

function timeScale(span: { min: number; max: number } | null): Scale {
  if (!span || !Number.isFinite(span.min) || !Number.isFinite(span.max)) {
    const now = Date.now();
    return { min: now - 60_000, max: now, span: 60_000 };
  }
  if (span.max <= span.min) return { min: span.min - 30_000, max: span.min + 30_000, span: 60_000 };
  return { min: span.min, max: span.max, span: span.max - span.min };
}

/* ---- Path helpers ---------------------------------------------------------- */

function buildAreaPath(points: Array<{ x: number; y: number }>, baseline: number): string {
  if (!points.length) return "";
  return `${monotonePath(points)}L${points[points.length - 1].x} ${baseline}L${points[0].x} ${baseline}Z`;
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
  /** Plot height in px. Defaults to 232, or 168 when `compact`. */
  height?: number;
  thresholds?: readonly ChartThreshold[];
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
  return seriesColor(index);
}

/**
 * Latest or inspected reading. `compact` is the device-card form: the numbers lead
 * and the sample time trails on the same row; a lone curve drops its visible label
 * because the card title already names it.
 */
export function ChartReadout({ info, inspecting = false, id, compact = false, toggle }: {
  info: ChartInspection | null;
  inspecting?: boolean;
  id?: string;
  compact?: boolean;
  /**
   * Turns each reading into the series' legend switch. A chart with three or
   * more curves used to print every label twice — once with its value above the
   * plot and again as a switch below it.
   */
  toggle?: { hidden: ReadonlySet<string>; onToggle: (label: string) => void };
}) {
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
        {info.values.map((item, index) => {
          const swatch = <span className="m3e-chart__swatch" style={{ background: seriesColor(index) }} aria-hidden="true" />;
          const hidden = toggle?.hidden.has(item.label) ?? false;
          return (
            <div key={`${index}-${item.label}`} className={hidden ? "is-series-hidden" : undefined}>
              <dt className={hideLabel ? "m3e-visually-hidden" : undefined}>
                {toggle
                  ? <button type="button" className="m3e-chart-readout__toggle" aria-pressed={!hidden} title={hidden ? "显示这条数据线" : "隐藏这条数据线"} onClick={() => toggle.onToggle(item.label)}>{swatch}{item.label}</button>
                  : <>{swatch}{item.label}</>}
              </dt>
              <dd><ChartReadingValue text={item.valueText} /></dd>
            </div>
          );
        })}
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
  readoutId,
  height: heightOverride,
  thresholds
}: TimeSeriesChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const generatedReadoutId = useId();
  const fingerprint = useMemo(() => seriesFingerprint(series), [series]);
  const stableSeries = useMemo(() => series, [fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps
  const index = useMemo(() => indexChartSamples(stableSeries), [stableSeries]);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const animations = chartAnimationsEnabled(reducedMotion);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  // Series the reader switched off in the legend, by label. Colours stay bound
  // to series position, so hiding one never repaints the others.
  const [hiddenLabels, setHiddenLabels] = useState<ReadonlySet<string>>(() => new Set());
  const showLegend = stableSeries.length >= 3;
  const isHidden = (label: string) => showLegend && hiddenLabels.has(label);
  const toggleSeries = (label: string) => setHiddenLabels((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label);
    // Never switch the last visible curve off; an empty plot answers nothing.
    else if (stableSeries.filter((item) => !next.has(item.label)).length > 1) next.add(label);
    return next;
  });
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

  const height = heightOverride ?? (compact ? 168 : 232);
  // Many curves on one plot read better thin; two or three stay bold.
  const strokeWidth = stableSeries.length > 4 ? 1.5 : 2;
  const hasData = index.timeline.length > 0;
  const svgWidth = Math.max(width, 240);
  const time = useMemo(() => timeScale(index.timeline.length ? { min: index.timeline[0], max: index.timeline[index.timeline.length - 1] } : null), [index]);
  const tickFormatter = valueFormatter ?? series.find((item) => item.valueFormatter)?.valueFormatter;
  const binaryAxis = formatsBytes(tickFormatter);
  const valueAxis = useMemo(
    // Hidden curves leave the scale too, so a quiet device can be read once a
    // busy one is switched off.
    () => niceLinearAxis(stableSeries.filter((item) => !(showLegend && hiddenLabels.has(item.label))).flatMap((item) => item.points.map((point) => point.value)), { pinnedMax: maxValue, binary: binaryAxis, tickCount: compact ? 3 : 4 }),
    [stableSeries, maxValue, binaryAxis, compact, showLegend, hiddenLabels]
  );
  const value: Scale = { min: valueAxis.min, max: valueAxis.max, span: valueAxis.max - valueAxis.min || 1 };
  const yTicks = valueAxis.ticks;
  const timeAxis = useMemo(() => niceTimeAxis(time.min, time.max, svgWidth < 360 ? 3 : svgWidth < 640 ? 4 : 6), [time, svgWidth]);
  const xTicks = timeAxis.ticks;
  // An outage is a span of the merged timeline where nobody reported.
  const silent = useMemo(() => silentSpans(index.timeline, gapThreshold(index.timeline)), [index]);
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
        {!hideReadout && <ChartReadout info={inspection ?? latest} inspecting={Boolean(inspection)} id={generatedReadoutId} toggle={showLegend ? { hidden: hiddenLabels, onToggle: toggleSeries } : undefined} />}
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
          {silent.map(([start, end]) => <rect key={`gap-${start}`} className="m3e-chart__gap" x={toX(start)} y={padding.top} width={Math.max(0, toX(end) - toX(start))} height={plotHeight}>
            <title>{`${formatAxisTimeLabel(start)} – ${formatAxisTimeLabel(end)} 没有上报`}</title>
          </rect>)}
          {yTicks.map((tick) => {
            const y = toY(tick);
            return <g key={`y-${tick}`}>
              <line className="m3e-chart__grid" x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} />
              <text className="m3e-chart__axis" x={padding.left - 8} y={y + 4} textAnchor="end">{tickText(tick)}</text>
            </g>;
          })}
          {(thresholds ?? []).filter((line) => line.value > value.min && line.value <= value.max).sort((a, b) => b.value - a.value).map((line, order, visible) => {
            const y = toY(line.value);
            // Two close lines (90 % and 98 %) would stack their labels; the lower
            // one then labels itself underneath.
            const crowded = order > 0 && y - toY(visible[order - 1].value) < 16;
            return <g key={`threshold-${line.tone}-${line.value}`} className={`m3e-chart__threshold m3e-chart__threshold--${line.tone}`} aria-hidden="true">
              <line x1={padding.left} y1={y} x2={svgWidth - padding.right} y2={y} />
              <text x={svgWidth - padding.right - 4} y={crowded ? y + 13 : y - 4} textAnchor="end">{line.label ?? tickText(line.value)}</text>
            </g>;
          })}
          {xTicks.map((tick) => {
            const x = toX(tick);
            // Keep edge labels inside the plot instead of clipping them.
            const anchor = x - padding.left < 28 ? "start" : svgWidth - padding.right - x < 28 ? "end" : "middle";
            return <text key={`x-${tick}`} className="m3e-chart__axis" x={x} y={height - 6} textAnchor={anchor}>{formatTimeTick(tick, timeAxis.step, time.span)}</text>;
          })}
          {stableSeries.map((item, position) => {
            const color = seriesColor(position);
            const samples = [...index.points[position]].sort(([a], [b]) => a - b);
            const points = samples.map(([timestamp, point]) => ({ t: timestamp, x: toX(timestamp), y: toY(point.value) }));
            if (!points.length || isHidden(item.label)) return null;
            // Each run of consecutive samples is its own path: an outage stays a gap.
            const runs = splitAtGaps(points, (point) => point.t, gapThreshold(samples.map(([timestamp]) => timestamp)));
            if (visualization === "bar") {
              const barWidth = Math.max(2, Math.min(18, plotWidth / points.length - 3));
              return <g key={item.label} fill={color}>{points.map((point, barIndex) => <rect key={barIndex} x={point.x - barWidth / 2} y={point.y} width={barWidth} height={Math.max(0, padding.top + plotHeight - point.y)} rx={Math.min(barWidth / 2, 4)}>
                {animations && <animate attributeName="opacity" from="0" to="1" dur="220ms" fill="freeze" />}
              </rect>)}</g>;
            }
            return <g key={item.label} className="m3e-chart__series" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={item.dashed ? "5 4" : undefined}>
              {visualization === "area" && runs.map((run) => <path key={`area-${run[0].t}`} d={buildAreaPath(run, padding.top + plotHeight)} fill={color} opacity="0.16" stroke="none" />)}
              {runs.map((run) => run.length === 1
                // A lone sample between outages is still a reading; draw it as a dot.
                ? <circle key={`dot-${run[0].t}`} cx={run[0].x} cy={run[0].y} r="3" fill={color} stroke="none" />
                : <path key={`line-${run[0].t}`} d={monotonePath(run)} />)}
            </g>;
          })}
          {inspection && <g className="m3e-chart__hover" aria-hidden="true">
            <line x1={hoverX} y1={padding.top} x2={hoverX} y2={padding.top + plotHeight} />
            {inspection.values.map((item, position) => item.point && !isHidden(item.label) ? <circle key={`${position}-${item.label}`} cx={hoverX} cy={toY(item.point.value)} r="4" fill={seriesColor(position)} /> : null)}
          </g>}
        </svg>
        {showLegend && hideReadout && <div className="m3e-chart__legend-toggles" role="group" aria-label="显示或隐藏数据线">
          {stableSeries.map((item, position) => <button
            key={item.label}
            type="button"
            className="m3e-chart__legend-toggle"
            aria-pressed={!hiddenLabels.has(item.label)}
            onClick={() => toggleSeries(item.label)}
          >
            <span className="m3e-chart__swatch" style={{ background: seriesColor(position) }} aria-hidden="true" />{item.label}
          </button>)}
        </div>}
      </>}
    </div>
  );
}

/* ---- Sparkline ------------------------------------------------------------- */

export type MetricTone = "normal" | "warning" | "critical";

/**
 * A trend without axes, for rows and tiles where the full chart is one click
 * away. It answers only "rising, falling or flat, and how high" — the value
 * itself is always printed next to it.
 */
export function Sparkline({ points, maxValue, tone = "normal", height = 32, className = "", ariaLabel }: {
  points: readonly SamplePoint[];
  /** Pins the top of the scale (100 for a percentage) so a quiet line stays low. */
  maxValue?: number;
  tone?: MetricTone;
  height?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const samples = useMemo(() => points
    .map((point) => ({ t: dateValueOf(point.timestamp), v: point.value }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
    .sort((left, right) => left.t - right.t), [points]);
  if (samples.length < 2) return <span className={`m3e-sparkline is-empty${className ? ` ${className}` : ""}`} style={{ height }} aria-hidden="true" />;
  const width = 100;
  const top = maxValue ?? Math.max(...samples.map((sample) => sample.v));
  const bottom = maxValue != null ? 0 : Math.min(...samples.map((sample) => sample.v));
  const span = top - bottom || 1;
  const first = samples[0].t;
  const duration = samples[samples.length - 1].t - first || 1;
  const xy = samples.map((sample) => ({ x: ((sample.t - first) / duration) * width, y: 2 + (height - 4) * (1 - (Math.min(sample.v, top) - bottom) / span) }));
  const line = monotonePath(xy);
  return (
    <svg className={`m3e-sparkline m3e-sparkline--${tone}${className ? ` ${className}` : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" height={height} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel} aria-hidden={ariaLabel ? undefined : true}>
      <path className="m3e-sparkline__area" d={`${line}L${width} ${height}L0 ${height}Z`} />
      <path className="m3e-sparkline__line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ---- Capacity bar ---------------------------------------------------------- */

/**
 * A filled bar with tick marks at the warning and critical thresholds. Replaces
 * donut and gauge charts for "how full is it": bars of the same length can be
 * compared down a column, and the distance to the next threshold is visible
 * before the colour changes.
 */
export function CapacityBar({ percent, tone = "normal", marks, label, size = "md", className = "" }: {
  percent: number | null | undefined;
  tone?: MetricTone;
  marks?: { warning: number; critical: number };
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const valid = typeof percent === "number" && Number.isFinite(percent);
  const width = valid ? Math.min(100, Math.max(0, percent)) : 0;
  return (
    <span
      className={`m3e-capacity m3e-capacity--${size} m3e-capacity--${valid ? tone : "unknown"}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label ? `${label} ${valid ? `${Math.round(width)}%` : "无数据"}` : undefined}
      aria-hidden={label ? undefined : true}
    >
      <span className="m3e-capacity__fill" style={{ width: `${width}%` }} />
      {marks ? <>
        <span className="m3e-capacity__mark m3e-capacity__mark--warning" style={{ left: `${marks.warning}%` }} />
        <span className="m3e-capacity__mark m3e-capacity__mark--critical" style={{ left: `${marks.critical}%` }} />
      </> : null}
    </span>
  );
}

export interface CapacityRow {
  key: string;
  label: string;
  /** Secondary line under the label, such as a mount point. */
  detail?: string;
  /** Right-aligned figure, such as "40.5 / 59.6 GB". */
  value: string;
  percent: number | null;
  tone?: MetricTone;
  marks?: { warning: number; critical: number };
}

/** Several capacities on one card, fullest first, so the one to act on leads. */
export function CapacityList({ rows, ariaLabel, sort = true }: { rows: readonly CapacityRow[]; ariaLabel: string; sort?: boolean }) {
  if (!rows.length) return <div className="m3e-chart-empty">{EMPTY_CHART_MESSAGE}</div>;
  const ordered = sort ? [...rows].sort((left, right) => (right.percent ?? -1) - (left.percent ?? -1)) : rows;
  return (
    <ul className="m3e-capacity-list" aria-label={ariaLabel}>
      {ordered.map((row) => {
        const known = row.percent != null && Number.isFinite(row.percent);
        return (
          <li key={row.key} className={`m3e-capacity-list__row is-${known ? row.tone ?? "normal" : "unknown"}`}>
            <div className="m3e-capacity-list__head">
              <span className="m3e-capacity-list__label"><strong>{row.label}</strong>{row.detail ? <small>{row.detail}</small> : null}</span>
              <span className="m3e-capacity-list__value"><strong>{known ? `${Math.round(row.percent as number)}%` : "—"}</strong><small>{row.value}</small></span>
            </div>
            <CapacityBar percent={row.percent} tone={row.tone} marks={row.marks} />
          </li>
        );
      })}
    </ul>
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
const secondClockFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
const dayClockFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * A tick says as much as its step needs: seconds for sub-minute steps, a date
 * for day steps, and on multi-day ranges the date at each local midnight so a
 * 7-day chart no longer shows seven unlabelled "00:00"s.
 */
function formatTimeTick(tick: number, step: number, span: number): string {
  const date = new Date(tick);
  if (Number.isNaN(date.getTime())) return "";
  if (step >= DAY) return dateFormatter.format(date);
  if (span > DAY && date.getHours() === 0 && date.getMinutes() === 0) return dateFormatter.format(date);
  return step < 60_000 ? secondClockFormatter.format(date) : clockFormatter.format(date);
}

export function formatAxisTimeLabel(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dayClockFormatter.format(date);
}

export { Icon as ChartIcon };
