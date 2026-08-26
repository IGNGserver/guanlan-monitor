import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SamplePoint, WidgetInstanceConfig, WidgetVisualization } from "@dsc/shared";
import {
  DesktopWidget,
  type WidgetKind,
  type WidgetSize
} from "./WidgetLayout";
import { useWorkspace } from "./WorkspaceContext";
import { Surface, SummaryRow } from "./ui";
import { formatAxisTime, formatPreciseDateTime, limitSamplePoints, splitPointsIntoSegments, WINDOW_DURATION_MAP } from "./formatters";

export type TelemetrySeries = {
  label: string;
  points: SamplePoint[];
  valueFormatter?: (value: number) => string;
};

function nearestSamplePoint(points: SamplePoint[], timestamp: string | undefined): SamplePoint | undefined {
  const validPoints = points.filter((point) => Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value));
  if (!validPoints.length) return undefined;
  const target = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(target)) return validPoints.at(-1);
  let nearest = validPoints[0];
  let nearestDistance = Math.abs(Date.parse(nearest.timestamp) - target);
  for (const point of validPoints.slice(1)) {
    const distance = Math.abs(Date.parse(point.timestamp) - target);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}
export function TelemetryChartCard({
  title,
  subtitle,
  series,
  valueFormatter = (val) => `${Math.round(val)}%`,
  fixedMaxValue,
  controls,
  footer,
  content,
  showDetailsControl = true,
  emptyMessage = "等待足够的遥测样本",
  widgetId,
  widgetTemplateId,
  widgetGroupId,
  widgetType,
  widgetCategory,
  widgetVisualization,
  widgetConfig,
  widgetKind = "content",
  widgetDefaultSize = "medium"
}: {
  title: string;
  subtitle?: string;
  series: TelemetrySeries[];
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  content?: React.ReactNode;
  showDetailsControl?: boolean;
  emptyMessage?: string;
  widgetId?: string;
  widgetTemplateId?: string;
  widgetGroupId?: string;
  widgetType?: string;
  widgetCategory?: string;
  widgetVisualization?: WidgetVisualization;
  widgetConfig?: WidgetInstanceConfig;
  widgetKind?: WidgetKind;
  widgetDefaultSize?: WidgetSize;
}) {
  const { metricsWindow, chartPointLimit } = useWorkspace();
  const visType: WidgetVisualization = widgetConfig?.visualization ?? widgetVisualization ?? "line";

  const activeSeries = useMemo(
    () => series
      .map((item) => ({ ...item, points: limitSamplePoints(item.points, chartPointLimit) }))
      .filter((item) => item.points && item.points.length > 0),
    [chartPointLimit, series]
  );
  const primaryPoints = activeSeries[0]?.points ?? [];
  const [selectedIndex, setSelectedIndex] = useState(Math.max(primaryPoints.length - 1, 0));
  const [isHovering, setIsHovering] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const pointerGestureRef = useRef<{ pointerId: number; index: number; startX: number; startY: number; moved: boolean } | null>(null);
  const chartId = useId().replace(/:/g, "");

  useEffect(() => {
    setSelectedIndex(Math.max(primaryPoints.length - 1, 0));
    setIsHovering(false);
    setIsPinned(false);
    pointerGestureRef.current = null;
  }, [primaryPoints.length, primaryPoints.at(-1)?.timestamp]);

  // This effect must stay before the empty-state return. A chart can move from
  // "no samples" to "samples available" after the first refresh, and hooks
  // must be called in the same order on both renders.
  useEffect(() => {
    if (!isPinned) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !plotRef.current?.contains(event.target)) {
        setIsPinned(false);
        setIsHovering(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isPinned]);

  const formatValue = (item: TelemetrySeries, value: number) => item.valueFormatter?.(value) ?? valueFormatter(value);

  const headerControls = controls || showDetailsControl ? (
    <div className="telemetry-chart-controls">
      {controls}
      {showDetailsControl && (
        <button
          type="button"
          className="workspace-btn workspace-btn--subtle telemetry-chart-details-btn"
          onClick={() => setShowDetails(!showDetails)}
          aria-label={showDetails ? "返回图表" : "查看详细信息"}
        >
          {showDetails ? "返回图表" : "详细信息"}
        </button>
      )}
    </div>
  ) : null;

  const hasContent = content !== undefined && content !== null;
  if ((!activeSeries.length || !primaryPoints.length) && !hasContent) {
    const emptyCard = (
      <Surface className="telemetry-chart-card">
        <div className="telemetry-chart-header">
          <div className="telemetry-chart-title">
            <h3>{title}</h3>
            {subtitle && <span>{subtitle}</span>}
          </div>
          {controls && <div className="telemetry-chart-controls">{controls}</div>}
        </div>
        <div className="workspace-trend workspace-trend--empty">
          <div className="workspace-trend-empty">{emptyMessage}</div>
        </div>
        {footer && <div className="telemetry-chart-card__details"><div className="telemetry-chart-card__footer">{footer}</div></div>}
      </Surface>
    );
    return widgetId ? (
      <DesktopWidget
        id={widgetId}
        templateId={widgetTemplateId}
        groupId={widgetGroupId}
        title={title}
        kind={widgetKind}
        defaultSize={widgetDefaultSize}
        widgetType={widgetType}
        category={widgetCategory}
        visualization={visType}
        config={{ ...widgetConfig, visualization: visType }}
      >
        {emptyCard}
      </DesktopWidget>
    ) : emptyCard;
  }

  // 1. Time window boundaries
  const windowDurationMs = WINDOW_DURATION_MAP[metricsWindow] ?? 300000;
  const allTimestamps = activeSeries.flatMap((s) => s.points.map((p) => Date.parse(p.timestamp))).filter((t) => Number.isFinite(t));
  const latestSampleTime = allTimestamps.length ? Math.max(...allTimestamps) : Date.now();
  const earliestSampleTime = allTimestamps.length ? Math.min(...allTimestamps) : latestSampleTime - windowDurationMs;
  const windowEndTime = latestSampleTime;
  // Keep the plotted interval within the selected range when the API returns
  // more history than requested; use all available samples only when the
  // device has less history than that range.
  const windowStartTime = Math.max(earliestSampleTime, windowEndTime - windowDurationMs);
  const totalSpan = Math.max(windowEndTime - windowStartTime, 1000);

  const timeToX = (timestampStr: string) => {
    const t = Date.parse(timestampStr);
    if (!Number.isFinite(t)) return 0;
    return Math.min(100, Math.max(0, ((t - windowStartTime) / totalSpan) * 100));
  };

  const allValues = activeSeries.flatMap((s) => s.points.map((p) => p.value)).filter((value) => Number.isFinite(value));
  const rawMax = Math.max(...allValues, 1);
  const maxValue = fixedMaxValue != null ? Math.max(fixedMaxValue, rawMax) : rawMax * 1.1;
  const yFor = (val: number) => 100 - Math.min(Math.max(val / maxValue, 0), 1) * 100;

  const pointsCount = primaryPoints.length;
  const curIndex = Math.min(selectedIndex, pointsCount - 1);
  const selectedTimestamp = primaryPoints[curIndex]?.timestamp;

  const resolveIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointsCount < 2) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 1;
    const hoverTime = windowStartTime + ratio * totalSpan;
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < pointsCount; i++) {
      const t = Date.parse(primaryPoints[i].timestamp);
      const diff = Math.abs(t - hoverTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    const newIndex = resolveIndex(event);
    setSelectedIndex(newIndex);
    if (isTouch) {
      pointerGestureRef.current = { pointerId: event.pointerId, index: newIndex, startX: event.clientX, startY: event.clientY, moved: false };
    } else {
      setIsHovering(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    if (isTouch) {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 10) {
        gesture.moved = true;
        if (isPinned) {
          setIsPinned(false);
          setIsHovering(false);
        }
        return;
      }
      if (isPinned) {
        setSelectedIndex(resolveIndex(event));
        setIsHovering(true);
      }
      return;
    }
    if (isPinned || event.pointerType !== "touch") {
      setSelectedIndex(resolveIndex(event));
      setIsHovering(true);
    }
  };

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      setSelectedIndex(resolveIndex(event));
      setIsHovering(true);
    }
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPinned && event.pointerType !== "touch" && event.pointerType !== "pen" && !event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      setIsHovering(false);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    if (isTouch) {
      const gesture = pointerGestureRef.current;
      pointerGestureRef.current = null;
      if (gesture?.pointerId === event.pointerId && !gesture.moved) {
        const shouldPin = !(isPinned && selectedIndex === gesture.index);
        setSelectedIndex(gesture.index);
        setIsPinned(shouldPin);
        setIsHovering(shouldPin);
      }
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      pointerGestureRef.current = null;
      setIsPinned(false);
      setIsHovering(false);
    }
  };

  const unpinTooltip = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setIsPinned(false);
    setIsHovering(false);
  };

  // Statistics
  const statsList = activeSeries.map((s) => {
    const vals = s.points.map((p) => p.value).filter((value) => Number.isFinite(value));
    const curVal = nearestSamplePoint(s.points, selectedTimestamp)?.value ?? vals[vals.length - 1] ?? 0;
    const firstMeaningfulIndex = vals.findIndex((value) => Number.isFinite(value) && value !== 0);
    const statsValues = firstMeaningfulIndex > 0 ? vals.slice(firstMeaningfulIndex) : vals;
    const maxVal = Math.max(...statsValues, 0);
    const minVal = statsValues.length ? Math.min(...statsValues) : 0;
    const avgVal = statsValues.reduce((a, b) => a + b, 0) / Math.max(statsValues.length, 1);
    return { label: s.label, formatter: (value: number) => formatValue(s, value), cur: curVal, avg: avgVal, max: maxVal, min: minVal };
  });

  const xPosition = timeToX(selectedTimestamp ?? "");
  const tooltipAlignment = xPosition <= 22 ? "is-start" : xPosition >= 78 ? "is-end" : "";
  const gradientOneId = `chart-fill-grad-1-${chartId}`;
  const gradientTwoId = `chart-fill-grad-2-${chartId}`;

  // Donut/Pie calculations
  const primaryVal = primaryPoints[curIndex]?.value ?? primaryPoints.at(-1)?.value ?? 0;
  const boundMax = fixedMaxValue != null ? fixedMaxValue : (allValues.length ? Math.max(...allValues, 1) : 100);
  const usedAmount = Math.min(boundMax, Math.max(0, primaryVal));
  const freeAmount = Math.max(0, boundMax - usedAmount);
  const usagePercentage = boundMax > 0 ? Math.min(100, Math.max(0, (usedAmount / boundMax) * 100)) : 0;
  const donutCircumference = 238.76;
  const donutDasharray = `${(usagePercentage / 100) * donutCircumference} ${donutCircumference}`;

  const chartCard = (
    <Surface className="telemetry-chart-card">
      <div className="telemetry-chart-header">
        <div className="telemetry-chart-title">
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : selectedTimestamp ? <span>采样于 {formatAxisTime(selectedTimestamp)}</span> : null}
        </div>
        {headerControls}
      </div>

      {hasContent ? (
        <div className="telemetry-chart-card__content">{content}</div>
      ) : showDetails ? (
        <div className="telemetry-chart-card__details">
          <div className="telemetry-chart-stats">
            {statsList.map((st, idx) => (
              <React.Fragment key={st.label}>
                <div className={`telemetry-stat-item ${idx === 0 ? "stat-primary" : idx === 1 ? "stat-green" : "stat-amber"}`}>
                  <label>{st.label} (当前)</label>
                  <strong>{st.formatter(st.cur)}</strong>
                </div>
                <div className="telemetry-stat-item">
                  <label>平均 (Avg)</label>
                  <strong>{st.formatter(st.avg)}</strong>
                </div>
                <div className="telemetry-stat-item">
                  <label>峰值 (Max)</label>
                  <strong>{st.formatter(st.max)}</strong>
                </div>
                <div className="telemetry-stat-item">
                  <label>谷值 (Min)</label>
                  <strong>{st.formatter(st.min)}</strong>
                </div>
              </React.Fragment>
            ))}
          </div>
          {footer && <div className="telemetry-chart-card__footer">{footer}</div>}
        </div>
      ) : visType === "donut" ? (
        <div className="telemetry-donut-card">
          <div className="telemetry-donut-visual">
            <svg viewBox="0 0 100 100" className="telemetry-donut-svg" aria-hidden="true">
              <circle cx="50" cy="50" r="38" className="telemetry-donut-track" />
              <circle
                cx="50"
                cy="50"
                r="38"
                className="telemetry-donut-arc"
                style={{
                  strokeDasharray: donutDasharray,
                  strokeDashoffset: 0
                }}
              />
            </svg>
            <div className="telemetry-donut-center">
              <span className="telemetry-donut-center__val">
                {fixedMaxValue === 100 ? `${Math.round(usedAmount)}%` : formatValue(activeSeries[0], usedAmount)}
              </span>
              <span className="telemetry-donut-center__label">{usagePercentage.toFixed(1)}% 占用</span>
            </div>
          </div>
          <div className="telemetry-donut-legend">
            <div className="telemetry-donut-legend__item">
              <span className="telemetry-donut-dot is-used" />
              <div className="telemetry-donut-legend__text">
                <label>当前占用 / 负载</label>
                <strong>{formatValue(activeSeries[0], usedAmount)}</strong>
              </div>
            </div>
            <div className="telemetry-donut-legend__item">
              <span className="telemetry-donut-dot is-free" />
              <div className="telemetry-donut-legend__text">
                <label>空闲 / 剩余空间</label>
                <strong>{formatValue(activeSeries[0], freeAmount)}</strong>
              </div>
            </div>
            <div className="telemetry-donut-legend__item">
              <span className="telemetry-donut-dot is-total" />
              <div className="telemetry-donut-legend__text">
                <label>总量上限</label>
                <strong>{formatValue(activeSeries[0], boundMax)}</strong>
              </div>
            </div>
          </div>
        </div>
      ) : visType === "number" ? (
        <div className="telemetry-number-grid">
          {activeSeries.map((item) => {
            const current = item.points.at(-1)?.value;
            return (
              <div className="telemetry-number" key={item.label}>
                <span>{item.label}</span>
                <strong>{current == null ? "—" : formatValue(item, current)}</strong>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="telemetry-chart-box">
          <div ref={plotRef} className={`telemetry-chart-plot${isPinned ? " is-pinned" : ""}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id={gradientOneId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--workspace-accent)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={gradientTwoId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--workspace-green)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--workspace-green)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* 背景刻度网格线 */}
              {[0, 25, 50, 75, 100].map((pos) => (
                <line key={pos} x1="0" x2="100" y1={pos} y2={pos} className="telemetry-chart-grid" />
              ))}

              {/* 多系列按连续段绘制 */}
              {activeSeries.map((s, idx) => {
                const segments = splitPointsIntoSegments(s.points, windowDurationMs);
                const lPath = segments.map((seg) => {
                  if (seg.length === 1) {
                    const x = timeToX(seg[0].timestamp).toFixed(2);
                    const y = yFor(seg[0].value).toFixed(2);
                    return `M ${x} ${y} L ${x} ${y}`;
                  }
                  return seg.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.timestamp).toFixed(2)} ${yFor(p.value).toFixed(2)}`).join(" ");
                }).join(" ");

                const fPath = segments.filter((seg) => seg.length > 1).map((seg) => {
                  const segLine = seg.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.timestamp).toFixed(2)} ${yFor(p.value).toFixed(2)}`).join(" ");
                  const firstX = timeToX(seg[0].timestamp).toFixed(2);
                  const lastX = timeToX(seg[seg.length - 1].timestamp).toFixed(2);
                  return `${segLine} L ${lastX} 100 L ${firstX} 100 Z`;
                }).join(" ");

                const lineClass = idx === 0 ? "telemetry-chart-line-1" : idx === 1 ? "telemetry-chart-line-2" : idx === 2 ? "telemetry-chart-line-3" : "telemetry-chart-line-4";
                const fillClass = idx === 0 ? "telemetry-chart-fill-1" : idx === 1 ? "telemetry-chart-fill-2" : "";

                return (
                  <g key={s.label}>
                    {fillClass && fPath && <path d={fPath} className={fillClass} style={{ fill: idx === 0 ? `url(#${gradientOneId})` : `url(#${gradientTwoId})` }} />}
                    {lPath && <path d={lPath} className={lineClass} />}
                  </g>
                );
              })}

              {/* 悬浮选中态 */}
              {isHovering && <rect x={Math.max(0, xPosition - 1.25)} y="0" width="2.5" height="100" className="telemetry-chart-selection-band" />}
              {isHovering && <line x1={xPosition} x2={xPosition} y1="0" y2="100" className="telemetry-chart-crosshair" />}
            </svg>

            {isHovering && activeSeries.map((s, idx) => (
              nearestSamplePoint(s.points, selectedTimestamp) ? (
                <div
                  key={`marker-${s.label}`}
                  className={`telemetry-chart-marker telemetry-chart-marker--${idx % 4}`}
                  style={{
                    left: `${timeToX(nearestSamplePoint(s.points, selectedTimestamp)?.timestamp ?? "")}%`,
                    top: `${yFor(nearestSamplePoint(s.points, selectedTimestamp)?.value ?? 0)}%`
                  }}
                />
              ) : null
            ))}

            <div className="telemetry-chart-axis-y">
              <span>{valueFormatter(maxValue)}</span>
              <span>{valueFormatter(0)}</span>
            </div>
            <div className="telemetry-chart-axis-x" aria-hidden="true">
              <span>{formatAxisTime(new Date(windowStartTime).toISOString())}</span>
              <span>{formatAxisTime(new Date(windowStartTime + totalSpan / 2).toISOString())}</span>
              <span>{formatAxisTime(new Date(windowEndTime).toISOString())}</span>
            </div>
            {isHovering && selectedTimestamp && (
              <div className={`telemetry-chart-tooltip ${tooltipAlignment}${isPinned ? " is-pinned" : ""}`} style={{ left: `${xPosition}%` }} role="status">
                <div className="telemetry-chart-tooltip__header">
                  <time>{formatPreciseDateTime(selectedTimestamp)}</time>
                  {isPinned && <button type="button" className="telemetry-chart-tooltip__close" onPointerDown={(event) => event.stopPropagation()} onClick={unpinTooltip} title="取消固定" aria-label="取消固定">×</button>}
                </div>
                <div className="telemetry-chart-tooltip__values">
                  {activeSeries.map((item, idx) => {
                    const point = nearestSamplePoint(item.points, selectedTimestamp);
                    if (!point) return null;
                    return <div className="telemetry-chart-tooltip__row" key={item.label}><i className={`telemetry-chart-tooltip__dot telemetry-chart-tooltip__dot--${idx % 4}`} /><span>{item.label}</span><strong>{formatValue(item, point.value)}</strong></div>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Surface>
  );

  return widgetId ? (
    <DesktopWidget
      id={widgetId}
      templateId={widgetTemplateId}
      groupId={widgetGroupId}
      title={title}
      kind={widgetKind}
      defaultSize={widgetDefaultSize}
      widgetType={widgetType}
      category={widgetCategory}
      visualization={visType}
      config={{ ...widgetConfig, visualization: visType }}
    >
      {chartCard}
    </DesktopWidget>
  ) : chartCard;
}

export function MiniTrend({
  points,
  label,
  valueFormatter = (value) => `${Math.round(value)}%`,
  fixedMaxValue = 100,
  compact = false
}: {
  points: SamplePoint[];
  label: string;
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  compact?: boolean;
}) {
  return <WorkspaceTrend points={points} label={label} valueFormatter={valueFormatter} fixedMaxValue={fixedMaxValue} compact={compact} />;
}

export function TelemetryInfoCard({
  title,
  subtitle,
  rows,
  widgetId,
  widgetTemplateId,
  widgetGroupId,
  widgetType,
  widgetCategory,
  widgetConfig,
  widgetDefaultSize = "medium"
}: {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value: string }>;
  widgetId?: string;
  widgetTemplateId?: string;
  widgetGroupId?: string;
  widgetType?: string;
  widgetCategory?: string;
  widgetConfig?: WidgetInstanceConfig;
  widgetDefaultSize?: WidgetSize;
}) {
  const card = (
    <Surface className="telemetry-chart-card">
      <div className="telemetry-chart-header">
        <div className="telemetry-chart-title">
          <h3>{title}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      <div className="workspace-detail-list telemetry-info-card__rows">
        {rows.map((row) => <SummaryRow key={row.label} label={row.label} value={row.value} />)}
      </div>
    </Surface>
  );
  return widgetId ? (
    <DesktopWidget
      id={widgetId}
      templateId={widgetTemplateId}
      groupId={widgetGroupId}
      title={title}
      kind="content"
      defaultSize={widgetDefaultSize}
      widgetType={widgetType}
      category={widgetCategory}
      visualization="table"
      config={{ ...widgetConfig, visualization: "table" }}
    >
      {card}
    </DesktopWidget>
  ) : card;
}

export function WorkspaceTrend({
  points,
  label = "指标",
  valueFormatter = (val) => `${Math.round(val)}%`,
  fixedMaxValue = 0,
  compact = false
}: {
  points: SamplePoint[];
  label?: string;
  valueFormatter?: (val: number) => string;
  fixedMaxValue?: number;
  compact?: boolean;
}) {
  const { metricsWindow, chartPointLimit } = useWorkspace();
  const chartPoints = useMemo(() => limitSamplePoints(points, chartPointLimit), [chartPointLimit, points]);
  const [selectedIndex, setSelectedIndex] = useState(Math.max(chartPoints.length - 1, 0));
  const [isHovering, setIsHovering] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const pointerGestureRef = useRef<{ pointerId: number; index: number; startX: number; startY: number; moved: boolean } | null>(null);
  useEffect(() => {
    setSelectedIndex(Math.max(chartPoints.length - 1, 0));
    setIsHovering(false);
    setIsPinned(false);
    pointerGestureRef.current = null;
  }, [chartPoints.length, chartPoints.at(-1)?.timestamp]);
  useEffect(() => {
    if (!isPinned) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !plotRef.current?.contains(event.target)) {
        setIsPinned(false);
        setIsHovering(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isPinned]);

  if (!chartPoints.length) {
    return <div className={`workspace-trend workspace-trend--empty ${compact ? "workspace-trend--compact" : ""}`} aria-label={label} role="img"><div className="workspace-trend-empty">等待足够的遥测样本</div></div>;
  }

  const windowDurationMs = WINDOW_DURATION_MAP[metricsWindow] ?? 300000;
  const timestamps = chartPoints.map((p) => Date.parse(p.timestamp)).filter((t) => Number.isFinite(t));
  const latestSampleTime = timestamps.length ? Math.max(...timestamps) : Date.now();
  const earliestSampleTime = timestamps.length ? Math.min(...timestamps) : latestSampleTime - windowDurationMs;
  const windowEndTime = latestSampleTime;
  // Keep the plotted interval within the selected range when the API returns
  // more history than requested; use all available samples only when the
  // device has less history than that range.
  const windowStartTime = Math.max(earliestSampleTime, windowEndTime - windowDurationMs);
  const totalSpan = Math.max(windowEndTime - windowStartTime, 1000);

  const timeToX = (timestampStr: string) => {
    const t = Date.parse(timestampStr);
    if (!Number.isFinite(t)) return 0;
    return Math.min(100, Math.max(0, ((t - windowStartTime) / totalSpan) * 100));
  };

  const maxValue = Math.max(fixedMaxValue, Math.max(...chartPoints.map((point) => point.value), 1));
  const yFor = (value: number) => 100 - Math.min(Math.max(value / maxValue, 0), 1) * 100;

  const segments = splitPointsIntoSegments(chartPoints, windowDurationMs);

  const linePath = segments.map((seg) => {
    if (seg.length === 1) {
      const x = timeToX(seg[0].timestamp).toFixed(2);
      const y = yFor(seg[0].value).toFixed(2);
      return `M ${x} ${y} L ${x} ${y}`;
    }
    return seg.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.timestamp).toFixed(2)} ${yFor(p.value).toFixed(2)}`).join(" ");
  }).join(" ");

  const fillPath = segments.filter((seg) => seg.length > 1).map((seg) => {
    const lPath = seg.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.timestamp).toFixed(2)} ${yFor(p.value).toFixed(2)}`).join(" ");
    const startX = timeToX(seg[0].timestamp).toFixed(2);
    const endX = timeToX(seg[seg.length - 1].timestamp).toFixed(2);
    return `${lPath} L ${endX} 100 L ${startX} 100 Z`;
  }).join(" ");

  const curIndex = Math.min(selectedIndex, chartPoints.length - 1);
  const selected = chartPoints[curIndex] ?? chartPoints[chartPoints.length - 1];
  const selectedX = timeToX(selected.timestamp);
  const selectedY = yFor(selected.value);

  const resolveIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!chartPoints.length) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 1;
    const hoverTime = windowStartTime + ratio * totalSpan;
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < chartPoints.length; i++) {
      const t = Date.parse(chartPoints[i].timestamp);
      const diff = Math.abs(t - hoverTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    const newIndex = resolveIndex(event);
    setSelectedIndex(newIndex);
    if (isTouch) {
      pointerGestureRef.current = { pointerId: event.pointerId, index: newIndex, startX: event.clientX, startY: event.clientY, moved: false };
    } else {
      setIsHovering(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    if (isTouch) {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 10) {
        gesture.moved = true;
        if (isPinned) {
          setIsPinned(false);
          setIsHovering(false);
        }
        return;
      }
      if (isPinned) {
        setSelectedIndex(resolveIndex(event));
        setIsHovering(true);
      }
      return;
    }
    if (isPinned || event.pointerType !== "touch") {
      setSelectedIndex(resolveIndex(event));
      setIsHovering(true);
    }
  };

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      setSelectedIndex(resolveIndex(event));
      setIsHovering(true);
    }
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPinned && event.pointerType !== "touch" && event.pointerType !== "pen" && !event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      setIsHovering(false);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
    if (isTouch) {
      const gesture = pointerGestureRef.current;
      pointerGestureRef.current = null;
      if (gesture?.pointerId === event.pointerId && !gesture.moved) {
        const shouldPin = !(isPinned && selectedIndex === gesture.index);
        setSelectedIndex(gesture.index);
        setIsPinned(shouldPin);
        setIsHovering(shouldPin);
      }
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      pointerGestureRef.current = null;
      setIsPinned(false);
      setIsHovering(false);
    }
  };

  const unpinTrend = (event?: React.SyntheticEvent) => {
    event?.stopPropagation();
    setIsPinned(false);
    setIsHovering(false);
  };

  return (
    <div className="workspace-trend" aria-label={label} role="img">
      {!compact && <div className="workspace-trend__readout"><span>{formatAxisTime(selected.timestamp)}</span><strong>{label} {valueFormatter(selected.value)}</strong></div>}
      <div ref={plotRef} className={`workspace-trend__chart ${compact ? "workspace-trend__chart--compact" : ""}${isPinned ? " is-pinned" : ""}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel}>
        {isPinned && <div className="workspace-trend__pin" role="status"><span>{formatAxisTime(selected.timestamp)}</span><strong>{label} {valueFormatter(selected.value)}</strong><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={unpinTrend} aria-label="取消固定" title="取消固定">×</button></div>}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="workspace-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--workspace-accent)" stopOpacity="0.22" /><stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3].map((index) => <line key={index} x1="0" x2="100" y1={(index / 3) * 100} y2={(index / 3) * 100} className="workspace-trend__grid" />)}
          {fillPath && <path d={fillPath} className="workspace-trend__fill" />}
          {linePath && <path d={linePath} className="workspace-trend__line" />}
          {isHovering && <line x1={selectedX} x2={selectedX} y1="0" y2="100" className="workspace-trend__selection" />}
        </svg>
        <div
          className="workspace-trend__marker-dot"
          style={{
            left: `${selectedX}%`,
            top: `${selectedY}%`,
          }}
        />
        <div className="workspace-trend-axis"><span>{valueFormatter(maxValue)}</span><span>{valueFormatter(0)}</span></div>
      </div>
      {!compact && <div className="workspace-trend__range"><span>{formatAxisTime(new Date(windowStartTime).toISOString())}</span><span>{formatAxisTime(new Date(windowEndTime).toISOString())}</span></div>}
    </div>
  );
}
