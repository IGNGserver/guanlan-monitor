import React, { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import type { AgentProbeProvider, AgentProbeTarget, CpuPackageStats, DeviceBlockKey, DeviceMetricKey, DesktopDetectedTargetGroup, DeviceSummary, SamplePoint, SystemStats } from "@dsc/shared";
import clsx from "clsx";
import appIcon from "../assets/app-icon.png";
import {
  SettingsSection,
  WorkspaceProvider,
  useWorkspace
} from "./WorkspaceContext";
import "./workspace.css";

type IconName =
  | "overview"
  | "hub"
  | "device"
  | "settings"
  | "back"
  | "search"
  | "refresh"
  | "collapse"
  | "chevron"
  | "external"
  | "copy"
  | "warning"
  | "check"
  | "clock"
  | "agent"
  | "appearance"
  | "connection"
  | "data"
  | "keyboard"
  | "about"
  | "arrow"
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  | "windowClose";

const iconPaths: Record<IconName, string[]> = {
  overview: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  hub: ["M4 9h16", "M6 9V6l6-3 6 3v3", "M6 9v9", "M12 9v9", "M18 9v9", "M4 18h16"],
  device: ["M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 20h8", "M12 18v2"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-2.4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L7.3 8.6 9 6.9l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.1h2.4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1V14h-.1a1.7 1.7 0 0 0-1.6 1z"],
  back: ["M19 12H5", "M11 18l-6-6 6-6"],
  search: ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "m21 21-4.4-4.4"],
  refresh: ["M20 11a8.1 8.1 0 0 0-14.7-3L3 11", "M3 5v6h6", "M4 13a8.1 8.1 0 0 0 14.7 3L21 13", "M21 19v-6h-6"],
  collapse: ["M9 6 3 12l6 6", "M15 6l6 6-6 6"],
  chevron: ["m6 9 6 6 6-6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"],
  copy: ["M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h0"],
  warning: ["M12 4 21 20H3L12 4z", "M12 10v4", "M12 17h.01"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  agent: ["M7 7h10v10H7z", "M4 10h3", "M17 10h3", "M10 4v3", "M14 4v3", "M10 17v3", "M14 17v3"],
  appearance: ["M12 3v18", "M3 12h18", "M5.6 5.6l12.8 12.8", "M18.4 5.6 5.6 18.4"],
  connection: ["M8 12h8", "M6 8h-1a4 4 0 0 0 0 8h1", "M18 8h1a4 4 0 0 1 0 8h-1", "M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0V8z"],
  data: ["M4 5h16v14H4z", "M8 9h8", "M8 13h5", "M8 16h3"],
  keyboard: ["M4 6h16v12H4z", "M7 10h.01", "M10 10h.01", "M13 10h.01", "M16 10h.01", "M7 14h10"],
  about: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 10v6", "M12 7h.01"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  windowMinimize: ["M5 19h14"],
  windowMaximize: ["M5 5h14v14H5z"],
  windowRestore: ["M8 8h11v11H8z", "M5 16V5h11"],
  windowClose: ["m6 6 12 12", "m18 6L6 18"]
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg className="workspace-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {iconPaths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  );
}

function Button({
  children,
  onClick,
  variant = "secondary",
  className = "",
  disabled = false,
  type = "button",
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button className={`workspace-button workspace-button--${variant} ${className}`} disabled={disabled} onClick={onClick} type={type} title={title}>
      {children}
    </button>
  );
}

function StatusDot({ state }: { state: "online" | "offline" | "cached" | "warning" | "unknown" }) {
  return <span className={`workspace-status-dot workspace-status-dot--${state}`} aria-hidden="true" />;
}

function StatusLabel({ state, compact = false }: { state: "online" | "offline" | "cached" | "warning" | "unknown"; compact?: boolean }) {
  const labels = { online: "在线", offline: "离线", cached: "缓存", warning: "异常", unknown: "未连接" };
  return (
    <span className={`workspace-status-label workspace-status-label--${state} ${compact ? "is-compact" : ""}`}>
      <StatusDot state={state} />
      {!compact && labels[state]}
    </span>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function MetricValue({ value, suffix = "%" }: { value: number | null | undefined; suffix?: string }) {
  return <span className="workspace-metric-value">{value == null ? "—" : `${value}${suffix}`}</span>;
}

function CapacityMetricValue({
  usedBytes,
  totalBytes,
  percentValue
}: {
  usedBytes?: number | null;
  totalBytes?: number | null;
  percentValue?: number | null;
}) {
  const hasCapacity = Number.isFinite(usedBytes) && Number.isFinite(totalBytes) && (totalBytes ?? 0) > 0;
  if (!hasCapacity) return <MetricValue value={percentValue} />;
  return (
    <span className="workspace-metric-value workspace-metric-value--capacity">
      <strong>{formatBytes(usedBytes)} / {formatBytes(totalBytes)}</strong>
      {percentValue != null && <small>{percentValue}%</small>}
    </span>
  );
}

function formatCapacitySummary(usedBytes: number | null | undefined, totalBytes: number | null | undefined): string {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || (totalBytes ?? 0) <= 0) return "容量暂无";
  return `已用 ${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds)) return "未采集";
  let remaining = Math.max(0, Math.round(seconds ?? 0));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days} 天`);
  if (hours || days) parts.push(`${hours} 小时`);
  parts.push(`${minutes} 分钟`);
  return parts.join(" ");
}

function formatCount(value: number | null | undefined): string {
  return Number.isFinite(value) && (value ?? 0) >= 0 ? Math.round(value ?? 0).toLocaleString("zh-CN") : "未采集";
}

function formatAxisTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function formatPreciseDateTime(value: string | null | undefined): string {
  if (!value) return "暂无时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function averageSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number; count: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = Date.parse(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) continue;
      const current = buckets.get(timestamp) ?? {
        timestamp: new Date(timestamp).toISOString(),
        total: 0,
        count: 0
      };
      current.total += point.value;
      current.count += 1;
      buckets.set(timestamp, current);
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket]) => ({ timestamp: bucket.timestamp, value: bucket.total / bucket.count }));
}

function averageSamplePointsOrFallback(groups: SamplePoint[][], fallback: SamplePoint[]): SamplePoint[] {
  const average = averageSamplePoints(groups);
  return average.length ? average : fallback;
}

function displayInstanceName(name: string | undefined, fallback: string): string {
  const value = name?.trim();
  return value || fallback;
}

function displayModelName(model: string | undefined, name: string | undefined, fallback: string): string {
  return displayInstanceName(model, displayInstanceName(name, fallback));
}

type TelemetrySeries = {
  label: string;
  points: SamplePoint[];
  valueFormatter?: (value: number) => string;
};

function TelemetryChartCard({
  title,
  subtitle,
  series,
  valueFormatter = (val) => `${Math.round(val)}%`,
  fixedMaxValue,
  controls,
  footer,
  emptyMessage = "等待足够的遥测样本"
}: {
  title: string;
  subtitle?: string;
  series: TelemetrySeries[];
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  emptyMessage?: string;
}) {
  const activeSeries = series.filter((item) => item.points && item.points.length > 0);
  const primaryPoints = activeSeries[0]?.points ?? [];
  const [selectedIndex, setSelectedIndex] = useState(Math.max(primaryPoints.length - 1, 0));
  const [isHovering, setIsHovering] = useState(false);
  const chartId = useId().replace(/:/g, "");

  useEffect(() => {
    setSelectedIndex(Math.max(primaryPoints.length - 1, 0));
    setIsHovering(false);
  }, [primaryPoints.length, primaryPoints.at(-1)?.timestamp]);

  if (!activeSeries.length || !primaryPoints.length) {
    return (
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
        {footer && <div className="telemetry-chart-card__footer">{footer}</div>}
      </Surface>
    );
  }

  const allValues = activeSeries.flatMap((s) => s.points.map((p) => p.value));
  const rawMax = Math.max(...allValues, 1);
  const maxValue = fixedMaxValue != null ? Math.max(fixedMaxValue, rawMax) : rawMax * 1.1;

  const pointsCount = primaryPoints.length;
  const xFor = (index: number) => (pointsCount <= 1 ? 50 : (index / (pointsCount - 1)) * 100);
  const yFor = (val: number) => 100 - Math.min(Math.max(val / maxValue, 0), 1) * 100;

  const curIndex = Math.min(selectedIndex, pointsCount - 1);
  const selectedTimestamp = primaryPoints[curIndex]?.timestamp;

  const resolveIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointsCount < 2) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 1;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * (pointsCount - 1));
  };

  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    setSelectedIndex(resolveIndex(event));
    setIsHovering(true);
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const stopHover = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) setIsHovering(false);
  };

  const formatValue = (item: TelemetrySeries, value: number) => item.valueFormatter?.(value) ?? valueFormatter(value);

  // 统计每个 series 的 Cur / Avg / Max / Min
  const statsList = activeSeries.map((s) => {
    const vals = s.points.map((p) => p.value);
    const curVal = s.points[curIndex]?.value ?? vals[vals.length - 1] ?? 0;
    // The first CPU/I/O sample can legitimately be a zero while its
    // counter baseline is being established. Do not let that placeholder
    // become the displayed minimum or pull down the average.
    const firstMeaningfulIndex = vals.findIndex((value) => Number.isFinite(value) && value !== 0);
    const statsValues = firstMeaningfulIndex > 0 ? vals.slice(firstMeaningfulIndex) : vals;
    const maxVal = Math.max(...statsValues, 0);
    const minVal = Math.min(...statsValues);
    const avgVal = statsValues.reduce((a, b) => a + b, 0) / Math.max(statsValues.length, 1);
    return { label: s.label, formatter: (value: number) => formatValue(s, value), cur: curVal, avg: avgVal, max: maxVal, min: minVal };
  });

  const xPosition = xFor(curIndex);
  const tooltipAlignment = curIndex <= Math.max(1, Math.floor(pointsCount * 0.18))
    ? "is-start"
    : curIndex >= Math.min(pointsCount - 2, Math.ceil(pointsCount * 0.82))
      ? "is-end"
      : "";
  const gradientOneId = `chart-fill-grad-1-${chartId}`;
  const gradientTwoId = `chart-fill-grad-2-${chartId}`;

  return (
    <Surface className="telemetry-chart-card">
      <div className="telemetry-chart-header">
        <div className="telemetry-chart-title">
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : selectedTimestamp ? <span>采样于 {formatAxisTime(selectedTimestamp)}</span> : null}
        </div>
        {controls && <div className="telemetry-chart-controls">{controls}</div>}
      </div>

      <div className="telemetry-chart-box">
        <div className="telemetry-chart-plot" onPointerDown={selectPoint} onPointerMove={selectPoint} onPointerEnter={selectPoint} onPointerLeave={stopHover}>
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

          {/* 多系列渲染 */}
          {activeSeries.map((s, idx) => {
            const lPath = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`).join(" ");
            const fPath = `${lPath} L 100 100 L 0 100 Z`;
            const lineClass = idx === 0 ? "telemetry-chart-line-1" : idx === 1 ? "telemetry-chart-line-2" : idx === 2 ? "telemetry-chart-line-3" : "telemetry-chart-line-4";
            const fillClass = idx === 0 ? "telemetry-chart-fill-1" : idx === 1 ? "telemetry-chart-fill-2" : "";

            return (
              <g key={s.label}>
                {fillClass && <path d={fPath} className={fillClass} style={{ fill: idx === 0 ? `url(#${gradientOneId})` : `url(#${gradientTwoId})` }} />}
                <path d={lPath} className={lineClass} />
              </g>
            );
          })}

          {/* 悬浮选中态：用实线和细微选中带替代突兀的虚线 */}
          {isHovering && <rect x={Math.max(0, xPosition - 1.25)} y="0" width="2.5" height="100" className="telemetry-chart-selection-band" />}
          {isHovering && <line x1={xPosition} x2={xPosition} y1="0" y2="100" className="telemetry-chart-crosshair" />}
        </svg>

        {isHovering && activeSeries.map((s, idx) => (
          s.points[curIndex] ? (
            <div
              key={`marker-${s.label}`}
              className={`telemetry-chart-marker telemetry-chart-marker--${idx % 4}`}
              style={{
                left: `${xPosition}%`,
                top: `${yFor(s.points[curIndex].value)}%`
              }}
            />
          ) : null
        ))}

        <div className="telemetry-chart-axis-y">
          <span>{valueFormatter(maxValue)}</span>
          <span>{valueFormatter(0)}</span>
        </div>
        <div className="telemetry-chart-axis-x" aria-hidden="true">
          <span>{formatAxisTime(primaryPoints[0]?.timestamp ?? "")}</span>
          <span>{formatAxisTime(primaryPoints[Math.floor((pointsCount - 1) / 2)]?.timestamp ?? "")}</span>
          <span>{formatAxisTime(primaryPoints[pointsCount - 1]?.timestamp ?? "")}</span>
        </div>
        {isHovering && selectedTimestamp && (
          <div className={`telemetry-chart-tooltip ${tooltipAlignment}`} style={{ left: `${xPosition}%` }} role="status">
            <time>{formatPreciseDateTime(selectedTimestamp)}</time>
            <div className="telemetry-chart-tooltip__values">
              {activeSeries.map((item, idx) => {
                const point = item.points[curIndex];
                if (!point) return null;
                return <div className="telemetry-chart-tooltip__row" key={item.label}><i className={`telemetry-chart-tooltip__dot telemetry-chart-tooltip__dot--${idx % 4}`} /><span>{item.label}</span><strong>{formatValue(item, point.value)}</strong></div>;
              })}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* 统计标盘 (Cur / Avg / Max / Min) */}
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
    </Surface>
  );
}

function MiniTrend({
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
  const [selectedIndex, setSelectedIndex] = useState(Math.max(points.length - 1, 0));
  const [isHovering, setIsHovering] = useState(false);
  useEffect(() => {
    setSelectedIndex(Math.max(points.length - 1, 0));
    setIsHovering(false);
  }, [points.length, points.at(-1)?.timestamp]);

  if (!points.length) {
    return <div className={`workspace-trend workspace-trend--empty ${compact ? "workspace-trend--compact" : ""}`} aria-label={label} role="img"><div className="workspace-trend-empty">等待足够的遥测样本</div></div>;
  }

  const maxValue = Math.max(fixedMaxValue, Math.max(...points.map((point) => point.value), 1));
  const xFor = (index: number) => points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
  const yFor = (value: number) => 100 - Math.min(Math.max(value / maxValue, 0), 1) * 100;
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(2)} ${yFor(point.value).toFixed(2)}`).join(" ");
  const fillPath = `${linePath} L 100 100 L 0 100 Z`;
  const selected = points[Math.min(selectedIndex, points.length - 1)] ?? points[points.length - 1];
  const selectedX = xFor(Math.min(selectedIndex, points.length - 1));
  const selectedY = yFor(selected.value);

  const resolveIndex = (event: React.PointerEvent<HTMLDivElement>) => {
    if (points.length < 2) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 1;
    return Math.round(Math.min(Math.max(ratio, 0), 1) * (points.length - 1));
  };
  const selectPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    setSelectedIndex(resolveIndex(event));
    setIsHovering(true);
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const stopHover = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) setIsHovering(false);
  };

  return (
    <div className="workspace-trend" aria-label={label} role="img">
      {!compact && <div className="workspace-trend__readout"><span>{formatAxisTime(selected.timestamp)}</span><strong>{label} {valueFormatter(selected.value)}</strong></div>}
      <div className={`workspace-trend__chart ${compact ? "workspace-trend__chart--compact" : ""}`} onPointerDown={selectPoint} onPointerMove={selectPoint} onPointerEnter={selectPoint} onPointerLeave={stopHover}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="workspace-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--workspace-accent)" stopOpacity="0.22" /><stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity="0" /></linearGradient></defs>
          {[0, 1, 2, 3].map((index) => <line key={index} x1="0" x2="100" y1={(index / 3) * 100} y2={(index / 3) * 100} className="workspace-trend__grid" />)}
          <path d={fillPath} className="workspace-trend__fill" />
          <path d={linePath} className="workspace-trend__line" />
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
      {!compact && points.length > 1 && <div className="workspace-trend__range"><span>{formatAxisTime(points[0].timestamp)}</span><span>{formatAxisTime(points[points.length - 1].timestamp)}</span></div>}
    </div>
  );
}

const metricGroups: Array<{ label: string; items: Array<{ key: DeviceMetricKey; label: string }> }> = [
  {
    label: "处理器",
    items: [
      { key: "cpuUsage", label: "CPU 使用率" },
      { key: "cpuFrequency", label: "CPU 频率" },
      { key: "cpuTemperature", label: "CPU 温度" },
      { key: "cpuTopology", label: "核心、线程与 L3 缓存" },
      { key: "systemOverview", label: "系统概览" }
    ]
  },
  {
    label: "显卡",
    items: [
      { key: "gpuUsage", label: "GPU 使用率" },
      { key: "gpuEncode", label: "编码负载" },
      { key: "gpuDecode", label: "解码负载" },
      { key: "gpuFrequency", label: "GPU 频率" },
      { key: "gpuMemory", label: "显存使用" },
      { key: "gpuTemperature", label: "GPU 温度" },
      { key: "gpuDriverInfo", label: "驱动信息" }
    ]
  },
  {
    label: "内存",
    items: [
      { key: "memoryUsage", label: "内存使用率" },
      { key: "swapUsage", label: "交换分区" },
      { key: "memoryAvailable", label: "可用内存" },
      { key: "memoryCached", label: "缓存内存" },
      { key: "memoryCommitted", label: "已提交内存" },
      { key: "memoryHardware", label: "内存硬件信息" }
    ]
  },
  {
    label: "磁盘",
    items: [
      { key: "diskUsage", label: "磁盘使用率" },
      { key: "diskRead", label: "读取速率" },
      { key: "diskWrite", label: "写入速率" },
      { key: "diskMetadata", label: "磁盘信息" },
      { key: "diskActivity", label: "活动状态" },
      { key: "diskHealth", label: "健康状态" }
    ]
  },
  {
    label: "网络",
    items: [
      { key: "networkRxRate", label: "接收速率" },
      { key: "networkTxRate", label: "发送速率" },
      { key: "networkTraffic", label: "流量统计" },
      { key: "networkIdentity", label: "网卡信息" }
    ]
  },
  {
    label: "风扇",
    items: [
      { key: "fanRpm", label: "转速" },
      { key: "fanControl", label: "控制状态" },
      { key: "fanTargetTemperature", label: "目标温度" },
      { key: "fanPwm", label: "PWM 占空比" },
      { key: "fanChannelState", label: "通道状态" },
      { key: "fanNote", label: "风扇备注" }
    ]
  }
];

const probeTargetLabels: Record<AgentProbeTarget, string> = {
  cpu: "CPU 处理器",
  gpu: "GPU 显卡",
  memory: "内存",
  disk: "磁盘",
  network: "网络",
  fan: "风扇",
  connection: "连接"
};

const probeProviderLabels: Record<AgentProbeProvider, string> = {
  builtin: "内置采集",
  gopsutil: "系统采集（gopsutil）",
  wmi: "Windows WMI",
  libreHardwareMonitor: "LibreHardwareMonitor",
  openHardwareMonitor: "OpenHardwareMonitor",
  redfish: "Redfish",
  disabled: "禁用"
};

function WorkspaceSidebar({ sidebarPeek, onSidebarLeave }: { sidebarPeek: boolean; onSidebarLeave: () => void }) {
  const {
    route,
    sidebarCollapsed,
    setSidebarCollapsed,
    hubs,
    collapsedHubs,
    toggleHub,
    navigate,
    openSettings,
    closeSettings,
    openExternal,
    snapshot,
    allDevices,
    instanceType,
    setInstanceType
  } = useWorkspace();
  const inSettings = route.kind === "settings";

  return (
    <aside className={`workspace-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${inSettings ? "is-settings" : ""}`} onMouseLeave={() => { if (sidebarCollapsed && sidebarPeek) onSidebarLeave(); }}>
      <div className="workspace-sidebar__topline">
        <button className="workspace-brand" type="button" onClick={() => (inSettings ? closeSettings() : navigate({ kind: "overview" }))} aria-label="返回总览">
          <img className="workspace-brand__mark-img" src={appIcon} alt="观澜" />
          <span className="workspace-brand__name">观澜</span>
        </button>
        <button className="workspace-icon-button workspace-sidebar__collapse" type="button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}>
          <Icon name="collapse" />
        </button>
      </div>

      {inSettings ? (
        <SettingsSidebar />
      ) : (
        <nav className="workspace-sidebar__nav" aria-label="设备控制台导航">
          <button className={`workspace-nav-item ${route.kind === "overview" ? "is-active" : ""}`} type="button" onClick={() => navigate({ kind: "overview" })} title="总览">
            <Icon name="overview" /> <span>总览</span>
          </button>
          <div className="workspace-sidebar__label"><span>接入中枢</span><span className="workspace-sidebar__count">{hubs.length}</span></div>
          <div className="workspace-instance-tabs" role="tablist" aria-label="实例类型">
            {(["device", "virtual_machine"] as const).map((type) => (
              <button
                key={type}
                className={`workspace-instance-tab ${instanceType === type ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={instanceType === type}
                onClick={() => {
                  const current = route.kind === "device" ? allDevices.find((device) => device.deviceId === route.deviceId) : null;
                  if (current && (current.instanceType ?? "device") !== type) navigate({ kind: "overview" });
                  setInstanceType(type);
                }}
              >
                {type === "device" ? "普通设备" : "虚拟机"}
              </button>
            ))}
          </div>
          {hubs.map((hub) => {
            const collapsed = Boolean(collapsedHubs[hub.id]);
            const hubActive = route.kind === "hub" && route.hubId === hub.id;
            return (
              <div className="workspace-hub-group" key={hub.id}>
                <div className={`workspace-hub-heading ${hubActive ? "is-active" : ""}`}>
                  <button className="workspace-hub-heading__main" type="button" onClick={() => navigate({ kind: "hub", hubId: hub.id })} title={hub.name}>
                    <StatusDot state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} />
                    <span className="workspace-hub-heading__name">{hub.name}</span>
                    <span className="workspace-hub-heading__count">{hub.devices.length}</span>
                  </button>
                  <button className="workspace-hub-heading__toggle" type="button" onClick={() => toggleHub(hub.id)} aria-label={collapsed ? `展开${hub.name}` : `折叠${hub.name}`}>
                    <Icon name="chevron" size={15} />
                  </button>
                </div>
                {!collapsed && (
                  <div className="workspace-device-list">
                    {hub.devices.length ? hub.devices.map((device) => (
                      <button className={`workspace-device-item ${route.kind === "device" && route.deviceId === device.deviceId ? "is-active" : ""}`} type="button" key={device.deviceId} onClick={() => navigate({ kind: "device", deviceId: device.deviceId })} title={device.hostname}>
                        <StatusDot state={device.status === "online" ? "online" : "offline"} />
                        <span className="workspace-device-item__copy"><strong>{device.hostname}</strong><small>{(device.instanceType ?? "device") === "virtual_machine" ? `宿主机：${device.hostName ?? "未知"}` : device.os} · <MetricValue value={device.cpuUsagePercent} /></small></span>
                      </button>
                    )) : <div className="workspace-sidebar__empty">尚未发现设备</div>}
                  </div>
                )}
              </div>
            );
          })}
          <div className="workspace-sidebar__spacer" />
          <button className="workspace-nav-item" type="button" onClick={() => openSettings("agent")} title="本机 Agent">
            <Icon name="agent" /> <span>本机 Agent</span>
          </button>
          <button className="workspace-nav-item" type="button" onClick={() => openSettings("connections")} title="连接设置">
            <Icon name="connection" /> <span>连接设置</span>
          </button>
        </nav>
      )}

      <div className="workspace-sidebar__footer">
        {inSettings ? (
          <button className="workspace-nav-item" type="button" onClick={closeSettings} title="返回设备控制台"><Icon name="back" /><span>返回控制台</span></button>
        ) : (
          <button className="workspace-nav-item" type="button" onClick={() => openSettings("general")} title="设置"><Icon name="settings" /><span>设置</span></button>
        )}
        <button className="workspace-sidebar__support" type="button" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")} title="打开帮助与反馈">
          <span>帮助与反馈</span><Icon name="external" size={14} />
        </button>
      </div>
    </aside>
  );
}

const settingsNav: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "通用", icon: "settings" },
  { id: "appearance", label: "外观", icon: "appearance" },
  { id: "connections", label: "中枢与连接", icon: "connection" },
  { id: "agent", label: "本机 Agent", icon: "agent" },
  { id: "data", label: "数据与更新", icon: "data" },
  { id: "shortcuts", label: "快捷键", icon: "keyboard" },
  { id: "about", label: "关于观澜", icon: "about" }
];

function SettingsSidebar() {
  const { route, navigate } = useWorkspace();
  return (
    <nav className="workspace-sidebar__nav" aria-label="设置导航">
      <div className="workspace-sidebar__section-title">设置</div>
      {settingsNav.map((item) => (
        <button className={`workspace-nav-item ${route.kind === "settings" && route.section === item.id ? "is-active" : ""}`} type="button" key={item.id} onClick={() => navigate({ kind: "settings", section: item.id })} title={item.label}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function WindowTitleBar() {
  const { minimizeWindow, toggleMaximizeWindow, closeWindow } = useWorkspace();
  const [isMaximized, setIsMaximized] = useState(false);
  const toggleMaximize = async () => {
    const next = await toggleMaximizeWindow();
    setIsMaximized(next);
  };
  return (
    <header className="workspace-windowbar">
      <div className="workspace-windowbar__drag" onDoubleClick={() => void toggleMaximize()}>
        <img className="workspace-windowbar__mark-img" src={appIcon} alt="观澜" />
        <strong>观澜</strong>
        <span className="workspace-windowbar__separator" aria-hidden="true" />
        <span className="workspace-windowbar__subtitle">设备状态控制台</span>
      </div>
      <div className="workspace-windowbar__controls" role="group" aria-label="窗口控制">
        <button className="workspace-window-control" type="button" onClick={() => void minimizeWindow()} aria-label="最小化" title="最小化"><Icon name="windowMinimize" size={15} /></button>
        <button className="workspace-window-control" type="button" onClick={() => void toggleMaximize()} aria-label={isMaximized ? "还原窗口" : "最大化"} title={isMaximized ? "还原窗口" : "最大化"}><Icon name={isMaximized ? "windowRestore" : "windowMaximize"} size={14} /></button>
        <button className="workspace-window-control workspace-window-control--close" type="button" onClick={() => void closeWindow()} aria-label="关闭窗口" title="关闭窗口"><Icon name="windowClose" size={15} /></button>
      </div>
    </header>
  );
}

function TopBar() {
  const { route, snapshot, refreshing, refresh, setCommandOpen, sidebarCollapsed, setSidebarCollapsed, openSettings } = useWorkspace();
  const title = route.kind === "overview" ? "总览" : route.kind === "device" ? "设备详情" : route.kind === "hub" ? "中枢详情" : settingsNav.find((item) => item.id === route.section)?.label ?? "设置";
  const sourceState = snapshot?.source === "cache" ? "cached" : snapshot?.session.authenticated ? "online" : snapshot?.source === "empty" ? "unknown" : "offline";
  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar__title">
        <button className="workspace-icon-button workspace-topbar__toggle" type="button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label="切换侧边栏">
          <Icon name="collapse" />
        </button>
        <div>
          <span className="workspace-topbar__eyebrow">设备状态控制台</span>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="workspace-topbar__actions">
        <StatusLabel state={sourceState} />
        <button className="workspace-search-trigger" type="button" onClick={() => setCommandOpen(true)}><Icon name="search" /><span>搜索设备</span><kbd>/</kbd></button>
        <Button variant="quiet" onClick={() => void refresh()} disabled={refreshing} title="刷新状态"><Icon name="refresh" size={16} />{!refreshing && <span>刷新</span>}</Button>
        {route.kind !== "settings" && <Button variant="quiet" onClick={() => openSettings("appearance")} title="外观设置"><Icon name="appearance" size={16} /></Button>}
      </div>
    </header>
  );
}

function ShellNotice() {
  const { notice } = useWorkspace();
  if (!notice) return null;
  return <div className={`workspace-toast workspace-toast--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>;
}

function CommandPalette() {
  const { commandOpen, setCommandOpen, searchQuery, setSearchQuery, filteredDevices, navigate, openSettings } = useWorkspace();
  const [activeIndex, setActiveIndex] = useState(0);
  if (!commandOpen) return null;
  const commands: Array<{ label: string; detail: string; action: () => void }> = [
    { label: "打开总览", detail: "查看所有中枢和设备状态", action: () => navigate({ kind: "overview" }) },
    { label: "打开连接设置", detail: "添加或重新认证中枢", action: () => openSettings("connections") },
    { label: "打开本机 Agent", detail: "控制本机采集服务", action: () => openSettings("agent") },
    ...filteredDevices.slice(0, 8).map((device) => ({ label: device.hostname, detail: `${device.os} · ${device.deviceId}`, action: () => navigate({ kind: "device", deviceId: device.deviceId }) }))
  ];
  const query = searchQuery.trim().toLowerCase();
  const filtered = query ? commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(query)) : commands;
  const select = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.action();
    setCommandOpen(false);
    setSearchQuery("");
  };
  return (
    <div className="workspace-overlay" role="presentation" onMouseDown={() => setCommandOpen(false)}>
      <section className="workspace-command" role="dialog" aria-modal="true" aria-label="搜索设备和命令" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspace-command__input"><Icon name="search" /><input autoFocus value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, filtered.length - 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); } else if (event.key === "Enter") { event.preventDefault(); select(activeIndex); } }} placeholder="搜索设备、页面或命令" /></div>
        <div className="workspace-command__list">
          {filtered.length ? filtered.map((command, index) => <button className={`workspace-command__item ${index === activeIndex ? "is-active" : ""}`} type="button" key={`${command.label}-${index}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(index)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><Icon name="arrow" size={15} /></button>) : <div className="workspace-command__empty">没有匹配结果</div>}
        </div>
        <div className="workspace-command__footer"><span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span><span><kbd>Esc</kbd>关闭</span></div>
      </section>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <div className="workspace-page-intro"><div>{eyebrow && <div className="workspace-page-intro__eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="workspace-page-intro__actions">{actions}</div>}</div>;
}

function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`workspace-surface ${className}`}>{children}</section>;
}

function DeviceRow({
  device,
  index,
  total,
  onMove,
  onDelete
}: {
  device: DeviceSummary;
  index?: number;
  total?: number;
  onMove?: (direction: -1 | 1) => void;
  onDelete?: () => void;
}) {
  const { navigate } = useWorkspace();
  const open = () => navigate({ kind: "device", deviceId: device.deviceId });
  const isVm = device.instanceType === "virtual_machine";
  return <div
    className="workspace-device-row"
    role="button"
    tabIndex={0}
    onClick={open}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
  >
    <span className="workspace-device-row__status"><StatusDot state={device.status === "online" ? "online" : "offline"} /></span>
    <span className="workspace-device-row__identity"><strong>{device.hostname}</strong><small>{isVm ? `宿主机：${device.hostName ?? "未知"}` : device.os} · {device.deviceId}</small></span>
    <span className="workspace-device-row__metric"><small>CPU</small><MetricValue value={device.cpuUsagePercent} /></span>
    <span className="workspace-device-row__metric"><small>内存</small><CapacityMetricValue usedBytes={device.memoryUsedBytes} totalBytes={device.memoryTotalBytes} percentValue={device.memoryUsagePercent} /></span>
    <span className="workspace-device-row__metric"><small>磁盘</small><CapacityMetricValue usedBytes={device.diskUsedBytes} totalBytes={device.diskTotalBytes} percentValue={device.diskUsagePercent} /></span>
    {onMove || onDelete ? <span className="workspace-device-row__actions" onClick={(event) => event.stopPropagation()}>
      {onMove && <>
        <button type="button" className="workspace-row-action" disabled={index === 0} onClick={() => onMove(-1)} aria-label="上移" title="上移">↑</button>
        <button type="button" className="workspace-row-action" disabled={index === (total ?? 0) - 1} onClick={() => onMove(1)} aria-label="下移" title="下移">↓</button>
      </>}
      {onDelete && <button type="button" className="workspace-row-action workspace-row-action--danger" onClick={onDelete} aria-label="删除实例" title="删除实例">×</button>}
    </span> : <Icon name="arrow" size={15} />}
  </div>;
}

function OverviewPage() {
  const { snapshot, hubs, devices, loading, error, refresh, navigate, openSettings, deleteInstance, reorderInstances } = useWorkspace();
  if (loading && !snapshot) return <LoadingSurface />;
  if (!snapshot) return <ErrorSurface title="无法读取设备状态" detail={error ?? "桌面桥接尚未准备好"} onRetry={() => void refresh()} />;
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.length - online;
  const localRunning = snapshot.localBackend?.running;
  const cached = snapshot.source === "cache";
  const noData = snapshot.source === "empty" || devices.length === 0;
  const issueCount = offline + (cached ? 1 : 0) + (noData ? 1 : 0) + (snapshot.localBackend?.lastIssueCount ?? 0);
  const overviewLatest = snapshot.metrics?.latest;
  const series = snapshot.metrics?.series;

  // 计算 TOP 5 资源消耗榜
  const topCpuDevices = [...devices].sort((a, b) => (b.cpuUsagePercent ?? 0) - (a.cpuUsagePercent ?? 0)).slice(0, 5);
  const topMemoryDevices = [...devices].sort((a, b) => (b.memoryUsagePercent ?? 0) - (a.memoryUsagePercent ?? 0)).slice(0, 5);

  const moveInstance = (deviceId: string, direction: -1 | 1) => {
    const currentIndex = devices.findIndex((device) => device.deviceId === deviceId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= devices.length) return;
    const next = [...devices];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    void reorderInstances(next.map((device) => device.deviceId));
  };

  const removeInstance = (device: DeviceSummary) => {
    const label = device.instanceType === "virtual_machine" ? "虚拟机实例" : "设备实例";
    if (window.confirm(`确定删除“${device.hostname}”这个${label}吗？删除后它不会显示在列表中；下次宿主机/Agent上报时会自动重新显示。`)) {
      void deleteInstance(device.deviceId);
    }
  };

  return (
    <div className="workspace-page workspace-page--overview">
      <PageIntro
        eyebrow="系统状态"
        title={issueCount ? `${issueCount} 项事项需要留意` : "所有中枢运行正常"}
        description={`最后同步于 ${formatDate(snapshot.generatedAt)}。${cached ? "当前显示的是离线缓存。" : "数据来自实时连接。"}`}
        actions={
          <>
            <Button variant="quiet" onClick={() => openSettings("connections")}>
              <Icon name="connection" size={16} />连接设置
            </Button>
            <Button variant="primary" onClick={() => void refresh()} disabled={loading}>
              <Icon name="refresh" size={16} />刷新状态
            </Button>
          </>
        }
      />

      {issueCount > 0 && (
        <div className="workspace-attention">
          <div className="workspace-attention__icon"><Icon name="warning" /></div>
          <div>
            <strong>{cached ? "中枢连接需要确认" : noData ? "还没有可用设备" : "设备状态存在异常"}</strong>
            <p>{cached ? "无法取得最新数据，页面中的设备信息可能已经过期。" : noData ? "连接中枢并等待设备上报后，这里会显示实时状态。" : `${offline} 台设备离线，${snapshot.localBackend?.lastIssueCount ?? 0} 条本机采集问题待处理。`}</p>
          </div>
          <Button variant="quiet" onClick={() => openSettings(cached || noData ? "connections" : "agent")}>
            查看详情<Icon name="arrow" size={15} />
          </Button>
        </div>
      )}



      {/* 设备列表 + 运维统计分析 */}
      <div className="workspace-overview-grid">
        <Surface className="workspace-overview-devices">
          <div className="workspace-surface__header">
            <div>
              <span className="workspace-section-kicker">设备概览</span>
              <h3>{devices.length} 台设备</h3>
            </div>
            <Button variant="quiet" onClick={() => navigate({ kind: "hub", hubId: hubs[0]?.id ?? "primary" })}>
              查看中枢<Icon name="arrow" size={15} />
            </Button>
          </div>
          <div className="workspace-device-rows">
            {devices.length ? (
              devices.map((device, index) => <DeviceRow
                key={device.deviceId}
                device={device}
                index={index}
                total={devices.length}
                onMove={(direction) => moveInstance(device.deviceId, direction)}
                onDelete={() => removeInstance(device)}
              />)
            ) : (
              <EmptyState title="还没有设备" detail="连接一个中枢后，设备会出现在这里。" action={<Button variant="primary" onClick={() => openSettings("connections")}>添加中枢</Button>} />
            )}
          </div>
        </Surface>

        {/* 侧栏 Top 5 排行与摘要 */}
        <div className="workspace-overview-column">
          <Surface className="workspace-top-ranking">
            <div className="workspace-surface__header">
              <div>
                <span className="workspace-section-kicker">负载排行</span>
                <h3>CPU 使用率 TOP 5</h3>
              </div>
            </div>
            <div className="workspace-ranking-list">
              {topCpuDevices.map((dev, idx) => (
                <div key={dev.deviceId} className="workspace-ranking-item">
                  <span className="workspace-ranking-badge">{idx + 1}</span>
                  <span className="workspace-ranking-name">{dev.hostname}</span>
                  <span className="workspace-ranking-val">{dev.cpuUsagePercent ?? 0}%</span>
                </div>
              ))}
            </div>
          </Surface>

          <Surface className="workspace-top-ranking">
            <div className="workspace-surface__header">
              <div>
                <span className="workspace-section-kicker">负载排行</span>
                <h3>内存占用 TOP 5</h3>
              </div>
            </div>
            <div className="workspace-ranking-list">
              {topMemoryDevices.map((dev, idx) => (
                <div key={dev.deviceId} className="workspace-ranking-item">
                  <span className="workspace-ranking-badge">{idx + 1}</span>
                  <span className="workspace-ranking-name">{dev.hostname}</span>
                  <span className="workspace-ranking-val"><CapacityMetricValue usedBytes={dev.memoryUsedBytes} totalBytes={dev.memoryTotalBytes} percentValue={dev.memoryUsagePercent} /></span>
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>

      {/* 核心网络与吞吐大图 */}
      {series && (
        <div className="workspace-overview-grid" style={{ gridTemplateColumns: "1fr" }}>
          <TelemetryChartCard
            title="实时网络吞吐"
            subtitle="当前设备网络接收(Rx)与发送(Tx)吞吐速率"
            series={[
              { label: "下行 (Rx)", points: series.networkRxBytesPerSec ?? [] },
              { label: "上行 (Tx)", points: series.networkTxBytesPerSec ?? [] }
            ]}
            valueFormatter={(v) => `${formatBytes(v)}/s`}
          />
        </div>
      )}

      <Surface className="workspace-hub-summary">
        <div className="workspace-surface__header">
          <div>
            <span className="workspace-section-kicker">接入中枢</span>
            <h3>连接概览</h3>
          </div>
          <Button variant="quiet" onClick={() => openSettings("connections")}>管理中枢</Button>
        </div>
        <div className="workspace-hub-summary__grid">
          {hubs.map((hub) => (
            <button className="workspace-hub-summary__item" type="button" key={hub.id} onClick={() => navigate({ kind: "hub", hubId: hub.id })}>
              <div>
                <StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} />
                <strong>{hub.name}</strong>
              </div>
              <span>{hub.endpoint}</span>
              <small>{hub.devices.length} 台设备 <Icon name="arrow" size={14} /></small>
            </button>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}

function MetricTile({ label, value, detail, tone, points }: { label: string; value: number | null | undefined; detail?: string; tone?: "blue" | "green" | "amber"; points?: SamplePoint[] }) {
  return <div className={`workspace-metric-tile ${tone ? `workspace-metric-tile--${tone}` : ""}`}><div className="workspace-metric-tile__header"><span>{label}</span><MetricValue value={value} /></div>{points && <MiniTrend compact label={label} points={points} />}{!points && <div className="workspace-metric-tile__empty">暂无趋势数据</div>}<small>{detail ?? "未采集"}</small></div>;
}

function TelemetrySection({
  eyebrow,
  title,
  description,
  controls,
  children
}: {
  eyebrow: string;
  title: string;
  description?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="workspace-telemetry-section">
      <div className="workspace-telemetry-section__header">
        <div>
          <span className="workspace-section-kicker">{eyebrow}</span>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {controls && <div className="workspace-telemetry-section__controls">{controls}</div>}
      </div>
      <div className="workspace-device-chart-grid">{children}</div>
    </section>
  );
}

function TelemetryDeviceBlock({
  kind,
  eyebrow,
  title,
  subtitle,
  children
}: {
  kind: "cpu" | "disk" | "gpu" | "network" | "fan";
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`workspace-device-block workspace-device-block--${kind}`}>
      <header className="workspace-device-block__header">
        <div className="workspace-device-block__identity">
          <span className="workspace-device-block__eyebrow">{eyebrow}</span>
          <h4>{title}</h4>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="workspace-device-block__marker" aria-hidden="true" />
      </header>
      <div className="workspace-device-block__charts">{children}</div>
    </article>
  );
}

type TelemetryInstanceSummary = {
  id: string;
  name: string;
  detail?: string;
};

function TelemetryModelList({ label, items }: { label: string; items: TelemetryInstanceSummary[] }) {
  return (
    <div className="workspace-telemetry-models">
      <span className="workspace-telemetry-models__label">{label}</span>
      {items.length ? (
        <div className="workspace-telemetry-models__list">
          {items.map((item) => (
            <span className="workspace-telemetry-model-chip" key={item.id} title={item.detail ? `${item.name} · ${item.detail}` : item.name}>
              <strong>{item.name}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
          ))}
        </div>
      ) : (
        <span className="workspace-telemetry-models__empty">未发现可参与聚合的实例</span>
      )}
    </div>
  );
}

function CpuFactsCard({ cpus, system }: { cpus: CpuPackageStats[]; system?: SystemStats }) {
  const sum = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
  };
  const facts = [
    { label: "运行时间", value: formatDuration(system?.uptimeSeconds), className: "workspace-cpu-fact--duration" },
    { label: "物理核心", value: formatCount(sum(cpus.map((cpu) => cpu.coreCount))) },
    { label: "逻辑线程", value: formatCount(sum(cpus.map((cpu) => cpu.logicalCount))) },
    { label: "L3 缓存", value: formatBytes(sum(cpus.map((cpu) => cpu.l3CacheBytes))) },
    { label: "系统线程", value: formatCount(system?.threadCount) },
    { label: "进程数", value: formatCount(system?.processCount) },
    { label: "句柄数", value: formatCount(system?.handleCount) }
  ];
  return (
    <Surface className="workspace-cpu-facts">
      <div className="workspace-cpu-facts__header">
        <div>
          <span className="workspace-section-kicker">任务管理器式摘要</span>
          <h3>处理器与系统统计</h3>
        </div>
        <span className="workspace-caption">{cpus.length ? `${cpus.length} 个 CPU 实例` : "CPU 实例未采集"}</span>
      </div>
      <div className="workspace-cpu-facts__grid">
        {facts.map((fact) => <div className={`workspace-cpu-fact ${fact.className ?? ""}`} key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}
      </div>
    </Surface>
  );
}

function InstanceFilter({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string; detail?: string }>;
}) {
  if (!options.length) return null;
  return (
    <label className="workspace-instance-filter">
      <span>{label}</span>
      <select className="workspace-select workspace-select--small" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">全部实例</option>
        {options.map((option) => <option value={option.id} key={option.id}>{option.name}{option.detail ? ` · ${option.detail}` : ""}</option>)}
      </select>
    </label>
  );
}

type DesktopMetricWindowValue = "5m" | "1h" | "6h" | "24h" | "7d";

const metricWindowOptions: Array<{ value: DesktopMetricWindowValue; label: string }> = [
  { value: "5m", label: "5 分钟" },
  { value: "1h", label: "1 小时" },
  { value: "6h", label: "6 小时" },
  { value: "24h", label: "24 小时" },
  { value: "7d", label: "7 天" }
];

function MetricWindowControl({ value, onChange }: { value: DesktopMetricWindowValue; onChange: (value: DesktopMetricWindowValue) => void }) {
  return (
    <div className="workspace-range-control" role="group" aria-label="遥测时间范围">
      <span className="workspace-range-control__label"><Icon name="clock" size={14} />时间范围</span>
      <div className="workspace-range-control__options">
        {metricWindowOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`workspace-range-option ${value === option.value ? "is-active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type DeviceTabKey = "overview" | "compute" | "storage_net" | "gpu_thermal" | "all";

function DevicePage() {
  const { selectedDevice, snapshot, navigate, openSettings, metricsWindow, setMetricsWindow, controlAgent, refreshing } = useWorkspace();
  const [activeTab, setActiveTab] = useState<DeviceTabKey>("overview");

  // 多实例单选中状态
  const [selectedNetId, setSelectedNetId] = useState<string>("all");
  const [selectedDiskId, setSelectedDiskId] = useState<string>("all");
  const [selectedGpuId, setSelectedGpuId] = useState<string>("all");

  if (!selectedDevice) return <EmptyState title="没有找到这台设备" detail="设备可能已被移除，或者中枢还没有返回它。" action={<Button variant="primary" onClick={() => navigate({ kind: "overview" })}>返回总览</Button>} />;

  const metrics = snapshot?.metrics?.device.deviceId === selectedDevice.deviceId ? snapshot.metrics : null;
  const localDevice = snapshot?.localBackend?.config.connection.deviceId === selectedDevice.deviceId;
  const latest = metrics?.latest;
  const series = metrics?.series;
  const enabledDeviceIds = localDevice ? snapshot?.localBackend?.config.enabledDeviceIds : metrics?.enabledDeviceIds;
  const hasInstanceConfiguration = (block: DeviceBlockKey) => Array.isArray(enabledDeviceIds?.[block]);
  const filterEnabledInstances = <T extends { id: string }>(block: DeviceBlockKey, instances: T[]) => {
    const configuredIds = enabledDeviceIds?.[block];
    return configuredIds ? instances.filter((instance) => configuredIds.includes(instance.id)) : instances;
  };
  const filteredDiskDetails = latest ? filterEnabledInstances("disk", latest.disks ?? []) : [];
  const filteredGpuDetails = latest ? filterEnabledInstances("gpu", latest.gpus ?? []) : [];
  const filteredLatest = latest
    ? {
        ...latest,
        cpuPackages: filterEnabledInstances("cpu", latest.cpuPackages ?? []),
        disks: filteredDiskDetails,
        networkInterfaces: filterEnabledInstances("network", latest.networkInterfaces ?? []),
        gpus: filteredGpuDetails,
        fans: filterEnabledInstances("fan", latest.fans ?? []),
        diskUsedBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? filteredDiskDetails.reduce((total, disk) => total + disk.usedBytes, 0) : latest.diskUsedBytes,
        diskTotalBytes: filteredDiskDetails.length || hasInstanceConfiguration("disk") ? filteredDiskDetails.reduce((total, disk) => total + disk.totalBytes, 0) : latest.diskTotalBytes
      }
    : undefined;

  const cpuInstances = filterEnabledInstances("cpu", series?.cpus ?? []);
  const diskInstances = filterEnabledInstances("disk", series?.disks ?? []);
  const networkInstances = filterEnabledInstances("network", series?.networks ?? []);
  const gpuInstances = filterEnabledInstances("gpu", series?.gpus ?? []);
  const fanInstances = filterEnabledInstances("fan", series?.fans ?? []);
  const visibleDiskInstances = selectedDiskId === "all" ? diskInstances : diskInstances.filter((disk) => disk.id === selectedDiskId);
  const visibleNetworkInstances = selectedNetId === "all" ? networkInstances : networkInstances.filter((network) => network.id === selectedNetId);
  const visibleGpuInstances = selectedGpuId === "all" ? gpuInstances : gpuInstances.filter((gpu) => gpu.id === selectedGpuId);
  const diskOptions = diskInstances.map((disk) => ({ id: disk.id, name: displayModelName(disk.model, disk.name, "磁盘"), detail: disk.mountPoint }));
  const networkOptions = networkInstances.map((network) => ({ id: network.id, name: displayModelName(network.model, network.name, "网卡") }));
  const gpuOptions = gpuInstances.map((gpu) => ({ id: gpu.id, name: gpu.name }));
  const cpuAverageUsage = averageSamplePointsOrFallback(cpuInstances.map((cpu) => cpu.usagePercent), hasInstanceConfiguration("cpu") ? [] : series?.cpuUsagePercent ?? []);
  const diskAverageUsedBytes = averageSamplePointsOrFallback(diskInstances.map((disk) => disk.usedBytes), hasInstanceConfiguration("disk") ? [] : series?.diskUsedBytes ?? []);
  const networkAverageRx = averageSamplePointsOrFallback(networkInstances.map((network) => network.rxBytesPerSec), hasInstanceConfiguration("network") ? [] : series?.networkRxBytesPerSec ?? []);
  const networkAverageTx = averageSamplePointsOrFallback(networkInstances.map((network) => network.txBytesPerSec), hasInstanceConfiguration("network") ? [] : series?.networkTxBytesPerSec ?? []);
  const gpuAverageUsage = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.usagePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuUsagePercent ?? []);
  const gpuAverageEncode = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.encodePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuEncodePercent ?? []);
  const gpuAverageDecode = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.decodePercent), hasInstanceConfiguration("gpu") ? [] : series?.gpuDecodePercent ?? []);
  const gpuAverageMemoryUsedBytes = averageSamplePointsOrFallback(gpuInstances.map((gpu) => gpu.memoryUsedBytes), hasInstanceConfiguration("gpu") ? [] : series?.gpuMemoryUsedBytes ?? []);
  const gpuMemorySummary = filteredLatest
    ? formatCapacitySummary(
        filteredLatest.gpus.reduce((total, gpu) => total + gpu.memoryUsedBytes, 0),
        filteredLatest.gpus.reduce((total, gpu) => total + gpu.memoryTotalBytes, 0)
      )
    : "容量暂无";
  const virtualMemorySummary = filteredLatest
    ? formatCapacitySummary(filteredLatest.memory.swapUsedBytes, filteredLatest.memory.swapTotalBytes)
    : "容量暂无";
  const cpuModelItems = cpuInstances.map((cpu) => ({
    id: cpu.id,
    name: displayModelName(cpu.model, cpu.name, "CPU"),
    detail: [cpu.coreCount ? `${cpu.coreCount} 核` : "", cpu.logicalCount ? `${cpu.logicalCount} 线程` : "", cpu.l3CacheBytes ? `L3 ${formatBytes(cpu.l3CacheBytes)}` : ""].filter(Boolean).join(" · ")
  }));
  const diskModelItems = diskInstances.map((disk) => ({
    id: disk.id,
    name: displayModelName(disk.model, disk.name, "磁盘"),
    detail: [disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ")
  }));
  const networkModelItems = networkInstances.map((network) => ({
    id: network.id,
    name: displayModelName(network.model, network.name, "网卡"),
    detail: [network.name, network.macAddress || network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ")
  }));
  const gpuModelItems = gpuInstances.map((gpu) => ({
    id: gpu.id,
    name: displayInstanceName(gpu.name, "GPU")
  }));

  return (
    <div className="workspace-page workspace-page--device">
      <PageIntro
        eyebrow={localDevice ? "本机设备" : "远端设备"}
        title={selectedDevice.hostname}
        description={`${selectedDevice.instanceType === "virtual_machine" ? "虚拟机" : selectedDevice.os} · ${selectedDevice.deviceId} · 最后心跳 ${formatDate(selectedDevice.lastSeenAt)}`}
        actions={
          <>
            <Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button>
            {localDevice && <Button variant="primary" onClick={() => openSettings("agent")}><Icon name="agent" size={16} />本机设置</Button>}
          </>
        }
      />

      <div className="workspace-device-statusline">
        <StatusLabel state={selectedDevice.status === "online" ? "online" : "offline"} />
        <span>Agent {selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "版本未知"}</span>
        <span>通道 {selectedDevice.agentChannel ?? "未知"}</span>
        {selectedDevice.instanceType === "virtual_machine" && <span>宿主机 {selectedDevice.hostName ?? "未知"}</span>}
        <span>数据更新时间 {formatDate(snapshot?.generatedAt)}</span>
      </div>



      {/* 视图 Tab 切换与时间范围控制器 */}
      <div className="telemetry-chart-header">
        <div className="workspace-tabs">
          <button className={`workspace-tab ${activeTab === "overview" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("overview")}>
            <Icon name="overview" size={15} /> 综合面板
          </button>
          <button className={`workspace-tab ${activeTab === "compute" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("compute")}>
            <Icon name="device" size={15} /> 算力与内存
          </button>
          <button className={`workspace-tab ${activeTab === "storage_net" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("storage_net")}>
            <Icon name="data" size={15} /> 存储与网络
          </button>
          <button className={`workspace-tab ${activeTab === "gpu_thermal" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("gpu_thermal")}>
            <Icon name="hub" size={15} /> 显卡与散热
          </button>
          <button className={`workspace-tab ${activeTab === "all" ? "is-active" : ""}`} type="button" onClick={() => setActiveTab("all")}>
            全景视图
          </button>
        </div>

        <MetricWindowControl value={metricsWindow as DesktopMetricWindowValue} onChange={(value) => setMetricsWindow(value)} />
      </div>

      {/* ================= Tab 1: 综合面板 (Overview) ================= */}
      {(activeTab === "overview" || activeTab === "all") && series && (
        <TelemetrySection eyebrow="综合遥测" title="硬件平均趋势" description="综合面板按类别平均所有已采集实例；各硬件型号显示在对应图表底部，单独图表请切换到明细选项卡。">
          <TelemetryChartCard title="CPU 平均使用率" subtitle={`全部 ${cpuInstances.length} 个 CPU 实例的平均值`} series={[{ label: "全部 CPU 平均", points: cpuAverageUsage }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} footer={<TelemetryModelList label="已采集 CPU 型号" items={cpuModelItems} />} />
           <TelemetryChartCard title="物理与虚拟内存" subtitle={`物理 ${formatCapacitySummary(filteredLatest?.memoryUsedBytes, filteredLatest?.memoryTotalBytes)} · 虚拟 ${virtualMemorySummary}`} series={[{ label: "已用物理内存", points: series.memoryUsedBytes ?? [], valueFormatter: formatBytes }, { label: "已用虚拟内存", points: series.swapUsedBytes ?? [], valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
           <TelemetryChartCard title="磁盘平均已用容量" subtitle={`全部 ${diskInstances.length} 个硬盘实例的平均值 · ${formatCapacitySummary(filteredLatest?.diskUsedBytes, filteredLatest?.diskTotalBytes)}`} series={[{ label: "全部硬盘平均已用", points: diskAverageUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} footer={<TelemetryModelList label="已采集硬盘型号" items={diskModelItems} />} />
           <TelemetryChartCard title="网卡平均吞吐" subtitle={`全部 ${networkInstances.length} 个网卡实例的平均值`} series={[{ label: "平均接收 (Rx)", points: networkAverageRx, valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "平均发送 (Tx)", points: networkAverageTx, valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} footer={<TelemetryModelList label="已采集网卡型号" items={networkModelItems} />} />
           <TelemetryChartCard title="GPU 平均使用率" subtitle={`全部 ${gpuInstances.length} 个显卡实例的平均值`} series={[{ label: "平均核心", points: gpuAverageUsage }, { label: "平均编码", points: gpuAverageEncode }, { label: "平均解码", points: gpuAverageDecode }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} footer={<TelemetryModelList label="已采集显卡型号" items={gpuModelItems} />} />
           <TelemetryChartCard title="GPU 平均显存已用容量" subtitle={`${gpuMemorySummary} · 按显卡实例平均`} series={[{ label: "平均显存已用", points: gpuAverageMemoryUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} footer={<TelemetryModelList label="已采集显卡型号" items={gpuModelItems} />} />
          {fanInstances.length ? fanInstances.map((fan) => <TelemetryChartCard key={`overview-fan-${fan.id}`} title={`${fan.name} · 风扇转速`} subtitle={fan.interface || "风扇实例"} series={[{ label: "转速", points: fan.rpm }]} valueFormatter={(v) => `${Math.round(v)} RPM`} />) : <div className="workspace-telemetry-empty">当前时间范围没有可用的风扇实例序列</div>}
        </TelemetrySection>
      )}

      {/* ================= Tab 2: 算力与内存 (Compute & Memory) ================= */}
      {(activeTab === "compute" || activeTab === "all") && series && (
        <TelemetrySection eyebrow="处理器与内存" title="算力与内存明细" description="CPU 实例、频率、温度和内存层级数据分开呈现，避免不同单位被压缩成一条汇总线。">
           <CpuFactsCard cpus={filteredLatest?.cpuPackages ?? []} system={filteredLatest?.system} />
           {cpuInstances.length ? cpuInstances.map((cpu) => {
             const cpuTemperaturePoints = cpu.temperatureC.length ? cpu.temperatureC : series.cpuTemperatureC ?? [];
             return (
               <TelemetryDeviceBlock
                 key={`compute-cpu-${cpu.id}`}
                 kind="cpu"
                 eyebrow="CPU 实例"
                 title={displayModelName(cpu.model, cpu.name, "CPU")}
                 subtitle={`${cpu.coreCount ?? "未知"} 核 · ${cpu.logicalCount ?? "未知"} 线程${cpu.l3CacheBytes ? ` · L3 ${formatBytes(cpu.l3CacheBytes)}` : ""}`}
               >
                 <TelemetryChartCard title="使用率" subtitle="处理器负载" series={[{ label: "使用率", points: cpu.usagePercent }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                 <TelemetryChartCard title="主频" subtitle="实时有效频率" series={[{ label: "频率", points: cpu.frequencyMHz, valueFormatter: (v) => `${Math.round(v)} MHz` }]} valueFormatter={(v) => `${Math.round(v)} MHz`} />
                 <TelemetryChartCard title="温度" subtitle="CPU Package / Core" emptyMessage="等待 CPU Package/Core 温度传感器" series={[{ label: "温度", points: cpuTemperaturePoints, valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
               </TelemetryDeviceBlock>
             );
           }) : hasInstanceConfiguration("cpu") ? <div className="workspace-telemetry-empty">当前已关闭所有 CPU 实例</div> : (
             <TelemetryDeviceBlock kind="cpu" eyebrow="CPU 汇总" title="处理器总览" subtitle="未拆分出独立 CPU 实例">
               <TelemetryChartCard title="使用率" series={[{ label: "CPU 占用", points: series.cpuUsagePercent ?? [] }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
             </TelemetryDeviceBlock>
           )}
           <TelemetryChartCard title="内存容量明细" subtitle={`物理 ${formatCapacitySummary(filteredLatest?.memoryUsedBytes, filteredLatest?.memoryTotalBytes)} · 虚拟 ${virtualMemorySummary}`} series={[{ label: "已用物理内存", points: series.memoryUsedBytes ?? [], valueFormatter: formatBytes }, { label: "已用虚拟内存", points: series.swapUsedBytes ?? [], valueFormatter: formatBytes }, { label: "缓存", points: series.memoryCachedBytes ?? [], valueFormatter: formatBytes }, { label: "已提交", points: series.memoryCommittedBytes ?? [], valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
           <TelemetryChartCard title="系统进程、线程与句柄" series={[{ label: "线程数", points: series.systemThreadCount ?? [] }, { label: "进程数", points: series.systemProcessCount ?? [] }, { label: "句柄数", points: series.systemHandleCount ?? [] }]} valueFormatter={(v) => `${Math.round(v)}`} />
        </TelemetrySection>
      )}

      {/* ================= Tab 3: 存储与网络 (Storage & Network) ================= */}
      {(activeTab === "storage_net" || activeTab === "all") && series && (
        <TelemetrySection eyebrow="存储与网络" title="I/O 实例明细" description="按网卡和磁盘实例拆分，选择全部时会同时展示每个实例，而不是只看设备总量。" controls={<><InstanceFilter label="网卡" value={selectedNetId} onChange={setSelectedNetId} options={networkOptions} /><InstanceFilter label="磁盘" value={selectedDiskId} onChange={setSelectedDiskId} options={diskOptions} /></>}>
          {networkInstances.length ? visibleNetworkInstances.map((network) => <TelemetryChartCard key={`network-${network.id}`} title={`${displayModelName(network.model, network.name, "网卡")} · 吞吐`} subtitle={[network.name, network.macAddress, network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ") || "独立网卡实例"} series={[{ label: "接收 (Rx)", points: network.rxBytesPerSec, valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "发送 (Tx)", points: network.txBytesPerSec, valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />) : hasInstanceConfiguration("network") ? <div className="workspace-telemetry-empty">当前已关闭所有网卡实例</div> : <TelemetryChartCard title="网络实时吞吐" subtitle="设备汇总" series={[{ label: "接收 (Rx)", points: series.networkRxBytesPerSec ?? [], valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "发送 (Tx)", points: series.networkTxBytesPerSec ?? [], valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />}
          {diskInstances.length ? visibleDiskInstances.map((disk) => {
            const diskLatest = filteredLatest?.disks?.find((item) => item.id === disk.id);
            return (
              <TelemetryDeviceBlock
                key={`disk-${disk.id}`}
                kind="disk"
                eyebrow="硬盘实例"
                title={displayModelName(disk.model, disk.name, "磁盘")}
                subtitle={[disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ") || "独立硬盘实例"}
              >
                <TelemetryChartCard title="已用容量" subtitle={formatCapacitySummary(diskLatest?.usedBytes, diskLatest?.totalBytes)} series={[{ label: "已用容量", points: disk.usedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
                <TelemetryChartCard title="读写速率" subtitle="当前硬盘 I/O" series={[{ label: "读取", points: disk.readBytesPerSec, valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "写入", points: disk.writeBytesPerSec, valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />
              </TelemetryDeviceBlock>
            );
          }) : hasInstanceConfiguration("disk") ? <div className="workspace-telemetry-empty">当前已关闭所有硬盘实例</div> : (
            <TelemetryDeviceBlock kind="disk" eyebrow="硬盘汇总" title="存储总览" subtitle={formatCapacitySummary(filteredLatest?.diskUsedBytes, filteredLatest?.diskTotalBytes)}>
              <TelemetryChartCard title="已用容量" series={[{ label: "已用容量", points: series.diskUsedBytes ?? [], valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
              <TelemetryChartCard title="读写速率" subtitle="设备汇总" series={[{ label: "读取", points: series.diskReadBytesPerSec ?? [], valueFormatter: (v) => `${formatBytes(v)}/s` }, { label: "写入", points: series.diskWriteBytesPerSec ?? [], valueFormatter: (v) => `${formatBytes(v)}/s` }]} valueFormatter={(v) => `${formatBytes(v)}/s`} />
            </TelemetryDeviceBlock>
          )}
        </TelemetrySection>
      )}

      {/* ================= Tab 4: 显卡与散热 (GPU & Thermal) ================= */}
      {(activeTab === "gpu_thermal" || activeTab === "all") && series && (
        <TelemetrySection eyebrow="显卡与散热" title="GPU、温度与风扇明细" description="每个 GPU 和每个风扇都有独立时间序列，悬停图表即可查看同一采样时刻的具体值。" controls={<InstanceFilter label="GPU" value={selectedGpuId} onChange={setSelectedGpuId} options={gpuOptions} />}>
          {gpuInstances.length ? visibleGpuInstances.map((gpu) => {
            const gpuLatest = filteredLatest?.gpus?.find((item) => item.id === gpu.id);
            const gpuTemperaturePoints = gpu.temperatureC.length ? gpu.temperatureC : series.gpuTemperatureC ?? [];
            const temperatureSubtitle = gpu.temperatureSource === "cpuPackageShared"
              ? "集成显卡未暴露独立温度 · 使用 CPU 封装温度"
              : "GPU 传感器温度";
            return (
              <TelemetryDeviceBlock
                key={`gpu-${gpu.id}`}
                kind="gpu"
                eyebrow="显卡实例"
                title={displayInstanceName(gpu.name, "GPU")}
                subtitle={gpuLatest ? `${formatCapacitySummary(gpuLatest.memoryUsedBytes, gpuLatest.memoryTotalBytes)} · ${temperatureSubtitle}` : temperatureSubtitle}
              >
                <TelemetryChartCard title="核心负载" subtitle="核心、编码与解码" series={[{ label: "核心", points: gpu.usagePercent }, { label: "编码", points: gpu.encodePercent }, { label: "解码", points: gpu.decodePercent }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
                <TelemetryChartCard title="显存已用容量" subtitle={formatCapacitySummary(gpuLatest?.memoryUsedBytes, gpuLatest?.memoryTotalBytes)} series={[{ label: "显存已用", points: gpu.memoryUsedBytes, valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
                <TelemetryChartCard title="温度" subtitle={temperatureSubtitle} emptyMessage="等待 GPU 温度传感器" series={[{ label: "温度", points: gpuTemperaturePoints, valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
              </TelemetryDeviceBlock>
            );
          }) : hasInstanceConfiguration("gpu") ? <div className="workspace-telemetry-empty">当前已关闭所有显卡实例</div> : (
            <TelemetryDeviceBlock kind="gpu" eyebrow="显卡汇总" title="GPU 总览" subtitle={`${gpuMemorySummary} · 设备汇总`}>
              <TelemetryChartCard title="核心负载" series={[{ label: "GPU 核心", points: series.gpuUsagePercent ?? [] }]} valueFormatter={(v) => `${Math.round(v)}%`} fixedMaxValue={100} />
              <TelemetryChartCard title="显存已用容量" subtitle={gpuMemorySummary} series={[{ label: "显存已用", points: series.gpuMemoryUsedBytes ?? [], valueFormatter: formatBytes }]} valueFormatter={formatBytes} />
              <TelemetryChartCard title="温度" subtitle="GPU 设备汇总" emptyMessage="等待 GPU 温度传感器" series={[{ label: "温度", points: series.gpuTemperatureC ?? [], valueFormatter: (v) => `${Math.round(v)} °C` }]} valueFormatter={(v) => `${Math.round(v)} °C`} />
            </TelemetryDeviceBlock>
          )}
          {fanInstances.length ? fanInstances.map((fan) => <TelemetryChartCard key={`thermal-fan-${fan.id}`} title={`${fan.name} · 转速`} subtitle={fan.interface || "风扇实例"} series={[{ label: "转速", points: fan.rpm, valueFormatter: (v) => `${Math.round(v)} RPM` }]} valueFormatter={(v) => `${Math.round(v)} RPM`} />) : <div className="workspace-telemetry-empty">当前时间范围没有可用的风扇实例序列</div>}
        </TelemetrySection>
      )}

      {/* 底部设备属性与 Agent 控制 */}
      <div className="workspace-device-grid" style={{ marginTop: 20 }}>
        <Surface>
          <div className="workspace-surface__header">
            <div>
              <span className="workspace-section-kicker">设备信息</span>
              <h3>硬件与系统</h3>
            </div>
            <button className="workspace-icon-button" type="button" onClick={() => void navigator.clipboard?.writeText(selectedDevice.deviceId)} title="复制设备 ID">
              <Icon name="copy" />
            </button>
          </div>
          <div className="workspace-detail-list">
            <SummaryRow label="操作系统" value={selectedDevice.os} />
            <SummaryRow label="设备 ID" value={selectedDevice.deviceId} />
            <SummaryRow label="Agent 版本" value={selectedDevice.agentVersion ? `v${selectedDevice.agentVersion}` : "未知"} />
             <SummaryRow label="CPU 型号" value={filteredLatest?.cpuPackages.map((cpu) => cpu.model || cpu.name).join("、") || "未采集"} />
             <SummaryRow label="运行时间" value={formatDuration(filteredLatest?.system.uptimeSeconds)} />
             <SummaryRow label="CPU 核心 / 线程" value={`${formatCount(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.coreCount ?? 0), 0))} / ${formatCount(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.logicalCount ?? 0), 0))}`} />
             <SummaryRow label="L3 缓存" value={formatBytes(filteredLatest?.cpuPackages.reduce((total, cpu) => total + (cpu.l3CacheBytes ?? 0), 0))} />
            <SummaryRow label="进程 / 系统线程 / 句柄" value={`${formatCount(filteredLatest?.system.processCount)} / ${formatCount(filteredLatest?.system.threadCount)} / ${formatCount(filteredLatest?.system.handleCount)}`} />
            <SummaryRow label="内存容量" value={filteredLatest ? formatCapacitySummary(filteredLatest.memoryUsedBytes, filteredLatest.memoryTotalBytes) : "未采集"} />
            <SummaryRow label="虚拟内存" value={filteredLatest ? virtualMemorySummary : "未采集"} />
            <SummaryRow label="磁盘容量" value={filteredLatest ? formatCapacitySummary(filteredLatest.diskUsedBytes, filteredLatest.diskTotalBytes) : "未采集"} />
            <SummaryRow label="网络接收" value={filteredLatest ? formatBytes(filteredLatest.networkRxBytesPerSec) + "/s" : "未采集"} />
            <SummaryRow label="网络发送" value={filteredLatest ? formatBytes(filteredLatest.networkTxBytesPerSec) + "/s" : "未采集"} />
          </div>
        </Surface>

        <Surface className="workspace-agent-surface">
          <div className="workspace-surface__header">
            <div>
              <span className="workspace-section-kicker">操作</span>
              <h3>{localDevice ? "本机 Agent" : "远端设备"}</h3>
            </div>
            <StatusLabel state={localDevice && snapshot?.localBackend?.running ? "online" : selectedDevice.status === "online" ? "online" : "offline"} />
          </div>
          {localDevice && snapshot?.localBackend ? (
            <>
              <p className="workspace-surface__description">本机采集服务负责向中枢上传设备状态和遥测数据。</p>
              <div className="workspace-action-row">
                <Button variant="primary" onClick={() => void controlAgent("restart")} disabled={refreshing}>重启服务</Button>
                <Button variant="quiet" onClick={() => void controlAgent(snapshot.localBackend?.running ? "stop" : "start")} disabled={refreshing}>
                  {snapshot.localBackend.running ? "停止服务" : "启动服务"}
                </Button>
              </div>
              <div className="workspace-detail-list">
                <SummaryRow label="连接状态" value={snapshot.localBackend.connectionStatus} />
                <SummaryRow label="待上传样本" value={String(snapshot.localBackend.pendingSampleCount)} />
                <SummaryRow label="采集间隔" value={`${snapshot.localBackend.effectiveUploadIntervalSeconds}s`} />
              </div>
            </>
          ) : (
            <>
              <p className="workspace-surface__description">远端设备只提供状态与遥测查看，不在此处修改采集配置。</p>
              <Button variant="quiet" onClick={() => openSettings("connections")}>查看中枢连接</Button>
            </>
          )}
        </Surface>
      </div>
    </div>
  );
}

function InstanceRow({ label, name, value }: { label: string; name: string; value: string }) {
  return <div className="workspace-instance-row"><span className="workspace-instance-row__label">{label}</span><span className="workspace-instance-row__name">{name}</span><strong>{value}</strong></div>;
}

function HubPage() {
  const { hubs, route, navigate, openSettings } = useWorkspace();
  const hub = hubs.find((item) => item.id === (route.kind === "hub" ? route.hubId : "")) ?? hubs[0];
  if (!hub) return <EmptyState title="没有配置中枢" detail="添加一个中枢后，设备会显示在侧边栏。" action={<Button variant="primary" onClick={() => openSettings("connections")}>添加中枢</Button>} />;
  const online = hub.devices.filter((device) => device.status === "online").length;
  return <div className="workspace-page"><PageIntro eyebrow="接入中枢" title={hub.name} description={hub.endpoint} actions={<><Button variant="quiet" onClick={() => navigate({ kind: "overview" })}><Icon name="back" size={16} />返回总览</Button><Button variant="primary" onClick={() => openSettings("connections")}><Icon name="settings" size={16} />管理连接</Button></>} /><div className="workspace-hub-hero"><div><StatusLabel state={hub.state === "online" ? "online" : hub.state === "cached" ? "cached" : hub.state === "offline" ? "warning" : "unknown"} /><strong>{hub.state === "online" ? "连接正常" : hub.state === "cached" ? "正在显示缓存" : "需要检查连接"}</strong><p>{online} 台设备在线，共 {hub.devices.length} 台设备。</p></div><div className="workspace-hub-hero__stat"><span>设备</span><strong>{hub.devices.length}</strong></div><div className="workspace-hub-hero__stat"><span>在线</span><strong>{online}</strong></div></div><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">设备列表</span><h3>{hub.devices.length} 台设备</h3></div><Button variant="quiet" onClick={() => openSettings("connections")}>连接设置</Button></div><div className="workspace-device-rows">{hub.devices.map((device) => <DeviceRow key={device.deviceId} device={device} />)}</div></Surface></div>;
}

function SettingsPage() {
  const { route } = useWorkspace();
  const section = route.kind === "settings" ? route.section : "general";
  const pages: Record<SettingsSection, React.ReactNode> = {
    general: <GeneralSettings />,
    appearance: <AppearanceSettings />,
    connections: <ConnectionSettings />,
    agent: <AgentSettings />,
    data: <DataSettings />,
    shortcuts: <ShortcutSettings />,
    about: <AboutSettings />
  };
  const heading = settingsNav.find((item) => item.id === section);
  return <div className="workspace-page workspace-page--settings"><PageIntro eyebrow="设置" title={heading?.label ?? "设置"} description={section === "general" ? "调整观澜的日常行为。" : undefined} />{pages[section]}</div>;
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return <div className="workspace-setting-row"><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="workspace-setting-row__control">{children}</div></div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="workspace-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span className="workspace-toggle__track"><span /></span></label>;
}

function GeneralSettings() {
  const { snapshot, updateStartupSettings, refreshInterval, setRefreshInterval } = useWorkspace();
  const startup = snapshot?.startup ?? { openAtLogin: false, startMinimized: false };
  return <Surface><div className="workspace-settings-list"><SettingRow label="开机启动" description="登录系统后自动启动观澜。"><Toggle checked={startup.openAtLogin} onChange={(checked) => void updateStartupSettings({ openAtLogin: checked })} label="开机启动" /></SettingRow><SettingRow label="启动时最小化" description="启动后保持在系统托盘，不打断当前工作。"><Toggle checked={startup.startMinimized} onChange={(checked) => void updateStartupSettings({ startMinimized: checked })} label="启动时最小化" /></SettingRow><SettingRow label="数据刷新频率" description="实时连接下，桌面端自动刷新状态的间隔。"><select className="workspace-select" value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.target.value) as typeof refreshInterval)}><option value="5">5 秒</option><option value="10">10 秒</option><option value="30">30 秒</option></select></SettingRow></div></Surface>;
}

function AppearanceSettings() {
  const { theme, setTheme, density, setDensity } = useWorkspace();
  return <Surface><div className="workspace-settings-list"><SettingRow label="主题" description="跟随系统，或固定使用浅色/深色主题。"><select className="workspace-select" value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></SettingRow><SettingRow label="界面密度" description="紧凑适合大屏监控，舒适适合日常操作。"><select className="workspace-select" value={density} onChange={(event) => setDensity(event.target.value as typeof density)}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></SettingRow><SettingRow label="动画" description="尊重系统的减少动态效果设置。"><span className="workspace-setting-note"><Icon name="check" size={15} />已启用可访问性适配</span></SettingRow></div></Surface>;
}

function ConnectionSettings() {
  const { snapshot, saveHubConnection, logout } = useWorkspace();
  const [serverUrl, setServerUrl] = useState(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [saving, setSaving] = useState(false);
  const authenticated = snapshot?.session.authenticated ?? false;
  useEffect(() => {
    setServerUrl(snapshot?.localBackend?.config.connection.serverUrl ?? "");
  }, [snapshot?.localBackend?.config.connection.serverUrl]);
  const saveConnection = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverUrl.trim() || (!accessKey.trim() && !snapshot?.session.accessKeyConfigured)) return;
    setSaving(true);
    try {
      const saved = await saveHubConnection(serverUrl, accessKey);
      if (saved) setAccessKey("");
    } finally {
      setSaving(false);
    }
  };
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">当前中枢</span><h3>{authenticated ? "已连接" : "需要认证"}</h3></div><StatusLabel state={authenticated ? "online" : "warning"} /></div><form className="workspace-form workspace-connection-form" onSubmit={saveConnection}><label>中枢地址<input className="workspace-input" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://hub.example.com" autoComplete="url" required /></label><label>访问密钥<input className="workspace-input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder={snapshot?.session.accessKeyConfigured ? "已保存，留空保留当前认证" : "输入中枢访问密钥"} autoComplete="current-password" required={!snapshot?.session.accessKeyConfigured} /></label><p className="workspace-form__hint">地址和访问密钥会在同一次保存中提交。访问密钥只会发送到桌面主进程，不会进入页面状态或日志。</p><div className="workspace-form__actions"><Button variant="primary" type="submit" disabled={saving}>{saving ? "正在保存…" : authenticated ? "保存连接" : "保存并连接"}</Button>{authenticated && <Button variant="quiet" onClick={() => void logout()} disabled={saving}>断开连接</Button>}</div></form></Surface><Surface className="workspace-connection-note"><div className="workspace-surface__header"><div><span className="workspace-section-kicker">连接诊断</span><h3>如果连接失败</h3></div></div><p className="workspace-surface__description">请确认地址包含协议（例如 https://），中枢服务已启动，并使用中枢访问密钥。保存按钮会先写入地址，再用同一地址完成认证，避免出现 server url is missing。</p></Surface></div>;
}

function AgentSettings() {
  const { snapshot, controlAgent, updateLocalConfig, cloudPush, refreshing } = useWorkspace();
  const backend = snapshot?.localBackend;
  const config = backend?.config;
  const enabledMetrics = config?.enabledMetrics ?? [];
  const configuredProbes = config?.probeSelections ?? [];
  const supportedProbePlans = Array.isArray(backend?.supportedProbePlans) ? backend.supportedProbePlans : [];
  const detectedTargets = Array.isArray(backend?.detectedTargets) ? backend.detectedTargets : [];
  const [selectedMetrics, setSelectedMetrics] = useState<DeviceMetricKey[]>(enabledMetrics);
  const [probeSelections, setProbeSelections] = useState(configuredProbes);
  const [enabledDeviceIds, setEnabledDeviceIds] = useState<Partial<Record<DeviceBlockKey, string[]>>>(config?.enabledDeviceIds ?? {});
  const fanSeries = snapshot?.metrics?.series?.fans ?? [];
  const metricDraftKey = enabledMetrics.join("|");
  const probeDraftKey = configuredProbes.map((selection) => `${selection.target}:${selection.provider}:${selection.enabled}`).join("|");
  const deviceDraftKey = JSON.stringify(config?.enabledDeviceIds ?? {});
  useEffect(() => {
    setSelectedMetrics(enabledMetrics);
  }, [metricDraftKey]);
  useEffect(() => {
    setProbeSelections(configuredProbes);
  }, [probeDraftKey]);
  useEffect(() => {
    setEnabledDeviceIds(config?.enabledDeviceIds ?? {});
  }, [deviceDraftKey]);
  if (!backend || !config) return <EmptyState title="本机 Agent 尚未启动" detail="启动本机服务后才能查看和修改采集设置。" action={<Button variant="primary" onClick={() => void controlAgent("start")}>启动服务</Button>} />;

  const detectedGroups: DesktopDetectedTargetGroup[] = (() => {
    if (!fanSeries.length) return detectedTargets;
    const fanGroup = detectedTargets.find((group) => group.target === "fan");
    if (fanGroup?.instances.length) return detectedTargets;
    const configuredFanIds = enabledDeviceIds.fan;
    const fanInstances = fanSeries.map((fan) => ({
      id: fan.id,
      name: fan.name,
      subtitle: fan.interface,
      enabled: configuredFanIds ? configuredFanIds.includes(fan.id) : true,
      metrics: ["转速"]
    }));
    if (fanGroup) return detectedTargets.map((group) => group.target === "fan" ? { ...group, instances: fanInstances } : group);
    return [...detectedTargets, { target: "fan", label: "风扇实例", instances: fanInstances }];
  })();

  const isInstanceEnabled = (target: AgentProbeTarget, id: string, fallback: boolean) => {
    if (target === "connection") return fallback;
    const configuredIds = enabledDeviceIds[target];
    return configuredIds ? configuredIds.includes(id) : fallback;
  };

  const toggleDetectedInstance = (target: AgentProbeTarget, id: string, enabled: boolean) => {
    if (target === "connection") return;
    const group = detectedGroups.find((item) => item.target === target);
    const fallbackIds = group?.instances.filter((instance) => instance.enabled).map((instance) => instance.id) ?? [];
    const currentIds = enabledDeviceIds[target] ?? fallbackIds;
    const nextIds = enabled ? Array.from(new Set([...currentIds, id])) : currentIds.filter((item) => item !== id);
    const nextEnabledDeviceIds = { ...enabledDeviceIds, [target]: nextIds };
    setEnabledDeviceIds(nextEnabledDeviceIds);
    // Instance switches are actions in their own right. Persist immediately so
    // leaving and re-entering settings cannot restore the previous selection.
    void updateLocalConfig({ enabledDeviceIds: nextEnabledDeviceIds });
  };

  const saveCollectionConfig = () => void updateLocalConfig({ enabledMetrics: selectedMetrics, enabledDeviceIds, probeSelections });
  const toggleMetric = (key: DeviceMetricKey) => {
    setSelectedMetrics((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };
  const updateProbe = (target: AgentProbeTarget, patch: { provider?: AgentProbeProvider; enabled?: boolean }) => {
    setProbeSelections((current) => {
      const existing = current.find((selection) => selection.target === target);
      if (existing) return current.map((selection) => selection.target === target ? { ...selection, ...patch } : selection);
      return [...current, { target, provider: patch.provider ?? "builtin", enabled: patch.enabled ?? true }];
    });
  };
  return (
    <div className="workspace-settings-stack">
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">服务状态</span><h3>本机 Agent</h3></div><StatusLabel state={backend.running ? "online" : "offline"} /></div>
        <div className="workspace-agent-actions"><Button variant="primary" onClick={() => void controlAgent(backend.running ? "stop" : "start")} disabled={refreshing}>{backend.running ? "停止服务" : "启动服务"}</Button><Button variant="quiet" onClick={() => void controlAgent("restart")} disabled={refreshing}>重启服务</Button><Button variant="quiet" onClick={() => void controlAgent("check-connection")} disabled={refreshing}>检查连接</Button><Button variant="quiet" onClick={() => void controlAgent("detect-probes")} disabled={refreshing}>重新检测硬件</Button></div>
        <div className="workspace-detail-list"><SummaryRow label="连接状态" value={backend.connectionStatus} /><SummaryRow label="上传间隔" value={`${backend.effectiveUploadIntervalSeconds} 秒`} /><SummaryRow label="待上传样本" value={backend.pendingSampleCount ? `${backend.pendingSampleCount} 条 · ${formatBytes(backend.pendingBytes)}` : "0 条"} /><SummaryRow label="配置文件" value={backend.configFileExists ? "已找到" : "未找到"} />{backend.lastUploadError && <SummaryRow label="最近上传错误" value={backend.lastUploadError} />}</div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">采集策略</span><h3>本机行为</h3></div></div>
        <div className="workspace-settings-list"><SettingRow label="自动启动采集" description="Agent 启动后自动开始采集硬件数据。"><Toggle checked={config.autoStartCollector} onChange={(checked) => void updateLocalConfig({ autoStartCollector: checked })} label="自动启动采集" /></SettingRow><SettingRow label="异常时自动重启" description="采集器异常退出后自动尝试恢复。"><Toggle checked={config.autoRestartCollector} onChange={(checked) => void updateLocalConfig({ autoRestartCollector: checked })} label="异常时自动重启" /></SettingRow><SettingRow label="上传到中枢" description="允许本机 Agent 将采样数据上传到当前中枢。"><Toggle checked={config.cloudSyncEnabled} onChange={(checked) => void updateLocalConfig({ cloudSyncEnabled: checked })} label="上传到中枢" /></SettingRow></div>
      </Surface>
      <Surface className="workspace-collection-surface">
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">上报数据</span><h3>选择 Agent 采集内容</h3></div><span className="workspace-caption">已选 {selectedMetrics.length} 项</span></div>
        <p className="workspace-surface__description">只采集并上报你勾选的指标；未选择的指标不会进入本机采集队列。完成选择后点击一次保存。</p>
        <div className="workspace-metric-option-grid">{metricGroups.map((group) => <div className="workspace-metric-option-group" key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <label className="workspace-check-row" key={item.key}><input type="checkbox" checked={selectedMetrics.includes(item.key)} onChange={() => toggleMetric(item.key)} /><span>{item.label}</span></label>)}</div>)}</div>
        <div className="workspace-probe-config"><div className="workspace-probe-config__header"><div><strong>硬件探针</strong><span>先启用探针来源，再在下方决定每个实例是否上报。</span></div></div>{supportedProbePlans.map((plan) => { const selection = probeSelections.find((item) => item.target === plan.target); const providers = plan.providers.filter((provider): provider is AgentProbeProvider => provider in probeProviderLabels); return <div className="workspace-probe-row" key={plan.target}><div><strong>{probeTargetLabels[plan.target]}</strong><small>{selection?.enabled === false ? "已停用" : "已启用"}</small></div><select className="workspace-select workspace-select--small" value={selection?.provider ?? plan.default} onChange={(event) => updateProbe(plan.target, { provider: event.target.value as AgentProbeProvider })}>{providers.map((provider) => <option value={provider} key={provider}>{probeProviderLabels[provider]}</option>)}</select><Toggle checked={selection?.enabled ?? true} onChange={(enabled) => updateProbe(plan.target, { enabled })} label={`${probeTargetLabels[plan.target]} 探针`} /></div>; })}</div>
        <div className="workspace-form__actions"><Button variant="primary" onClick={saveCollectionConfig} disabled={refreshing}>保存采集配置</Button><Button variant="quiet" onClick={() => void cloudPush()} disabled={refreshing}>同步到中枢</Button></div>
      </Surface>
      <Surface>
        <div className="workspace-surface__header"><div><span className="workspace-section-kicker">检测结果</span><h3>已发现硬件</h3><p className="workspace-surface__description">关闭某个实例后立即停止上报并写入本机配置；指标和探针来源仍需点击“保存采集配置”。</p></div><span className="workspace-caption">{detectedGroups.reduce((count, group) => count + group.instances.length, 0)} 个实例</span></div>
        {detectedGroups.length ? <div className="workspace-detected-list">{detectedGroups.map((group) => <div className="workspace-detected-group" key={group.target}><strong>{group.label}</strong>{group.instances.map((instance) => { const enabled = isInstanceEnabled(group.target, instance.id, instance.enabled); return <div className="workspace-detected-row" key={instance.id}><div className="workspace-detected-row__identity"><strong>{instance.name}</strong>{instance.subtitle && <small>{instance.subtitle}</small>}</div><div className="workspace-detected-row__control"><small className={enabled ? "is-enabled" : "is-disabled"}>{enabled ? "上报中" : "不上传"}</small><Toggle checked={enabled} onChange={(checked) => toggleDetectedInstance(group.target, instance.id, checked)} label={`${instance.name} 上报`} /></div></div>; })}</div>)}</div> : <div className="workspace-muted-block">尚未检测到硬件探针，请点击“重新检测硬件”。</div>}
      </Surface>
    </div>
  );
}

function DataSettings() {
  const { snapshot, openExternal } = useWorkspace();
  const update = snapshot?.update;
  return <div className="workspace-settings-stack"><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">缓存</span><h3>数据与更新</h3></div></div><div className="workspace-detail-list"><SummaryRow label="数据来源" value={snapshot?.source === "cache" ? "离线缓存" : snapshot?.source === "live" ? "实时连接" : "无数据"} /><SummaryRow label="缓存时间" value={formatDate(snapshot?.cache.savedAt)} /><SummaryRow label="缓存年龄" value={snapshot?.cache.ageSeconds == null ? "—" : `${snapshot.cache.ageSeconds} 秒`} /><SummaryRow label="当前版本" value={update?.currentVersion ?? "未知"} /></div></Surface><Surface><div className="workspace-surface__header"><div><span className="workspace-section-kicker">版本</span><h3>{update?.available ? `可用更新：${update.latestVersion}` : "当前已是最新版本"}</h3></div>{update?.available && <StatusLabel state="warning" />}</div>{update?.message && <p className="workspace-surface__description">{update.message}</p>}{update?.releaseUrl && <Button variant="quiet" onClick={() => void openExternal(update.releaseUrl!)}>查看更新说明<Icon name="external" size={15} /></Button>}</Surface></div>;
}

function ShortcutSettings() {
  const shortcuts = [["/ 或 Ctrl/⌘ + K", "打开搜索和命令面板"], ["F5 或 Ctrl/⌘ + R", "刷新设备状态"], ["Esc", "关闭当前弹层"], ["Ctrl/⌘ + B", "折叠侧边栏"], ["Ctrl/⌘ + ,", "打开设置"]];
  return <Surface><div className="workspace-shortcut-list">{shortcuts.map(([key, description]) => <div className="workspace-shortcut-row" key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</div></Surface>;
}

function AboutSettings() {
  const { snapshot, openExternal } = useWorkspace();
  return <Surface><div className="workspace-about"><div className="workspace-about__mark-wrap"><img className="workspace-about__mark-img" src={appIcon} alt="观澜" /></div><h3>观澜设备状态控制台</h3><p>面向本机 Agent 和接入中枢的状态工作区。</p><div className="workspace-detail-list"><SummaryRow label="版本" value={snapshot?.update?.currentVersion ?? "开发版本"} /><SummaryRow label="发布通道" value={snapshot?.update?.currentChannel ?? "测试"} /></div><div className="workspace-form__actions"><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor")}><Icon name="external" size={15} />项目主页</Button><Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor/issues")}><Icon name="external" size={15} />报告问题</Button></div></div></Surface>;
}

function LoadingSurface() {
  return <div className="workspace-page"><div className="workspace-skeleton workspace-skeleton--hero" /><div className="workspace-skeleton workspace-skeleton--large" /><div className="workspace-skeleton workspace-skeleton--medium" /></div>;
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="workspace-empty"><div className="workspace-empty__mark"><Icon name="overview" size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

function ErrorSurface({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <EmptyState title={title} detail={detail} action={<Button variant="primary" onClick={onRetry}><Icon name="refresh" size={16} />重试</Button>} />;
}

function RouteView() {
  const { route, error, refresh, loading, snapshot } = useWorkspace();
  if (route.kind === "settings") return <SettingsPage />;
  if (loading && !snapshot) return <LoadingSurface />;
  if (route.kind === "device") return <DevicePage />;
  if (route.kind === "hub") return <HubPage />;
  if (error) return <ErrorSurface title="无法同步设备状态" detail={error} onRetry={() => void refresh()} />;
  return <OverviewPage />;
}

function WorkspaceFrame() {
  const { sidebarCollapsed } = useWorkspace();
  const [sidebarPeek, setSidebarPeek] = useState(false);
  useEffect(() => {
    if (!sidebarCollapsed) setSidebarPeek(false);
  }, [sidebarCollapsed]);
  return <div className={clsx("workspace-root", sidebarCollapsed && "is-sidebar-collapsed", sidebarPeek && "is-sidebar-peek")}><WindowTitleBar /><WorkspaceSidebar sidebarPeek={sidebarPeek} onSidebarLeave={() => setSidebarPeek(false)} /><div className="workspace-main"><TopBar /><main className="workspace-content" id="workspace-main-content"><RouteView /></main></div>{sidebarCollapsed && <button className="workspace-sidebar-edge-trigger" type="button" aria-label="展开侧边栏" onMouseEnter={() => setSidebarPeek(true)} onPointerEnter={() => setSidebarPeek(true)} />}<CommandPalette /><ShellNotice /></div>;
}

export function WorkspaceApp() {
  return <WorkspaceProvider><WorkspaceFrame /></WorkspaceProvider>;
}

export default WorkspaceApp;
