import React, { useMemo, useState } from "react";
import { StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper } from "@carbon/react";
import type { SamplePoint, WidgetInstanceConfig, WidgetVisualization } from "@dsc/shared";
import { CarbonTimeSeriesChart, type CarbonSeries } from "./CarbonCharts";
import { DesktopWidget, type WidgetKind, type WidgetSize } from "./WidgetLayout";
import { useWorkspace } from "./WorkspaceContext";
import { Surface } from "./ui";
import { Button } from "./ui";
import { limitSamplePoints } from "./formatters";

export type TelemetrySeries = CarbonSeries;

function formatValue(item: TelemetrySeries, value: number, fallback: (value: number) => string) {
  return item.valueFormatter?.(value) ?? fallback(value);
}

function currentValue(item: TelemetrySeries) {
  const point = item.points.at(-1);
  return point && Number.isFinite(point.value) ? point.value : undefined;
}

function DetailRows({ series, valueFormatter }: { series: TelemetrySeries[]; valueFormatter: (value: number) => string }) {
  return (
    <StructuredListWrapper className="telemetry-detail-list" aria-label="指标详情" isCondensed isFlush>
      <StructuredListBody>
      {series.map((item) => {
        const values = item.points.map((point) => point.value).filter((value) => Number.isFinite(value));
        const current = values.at(-1);
        const peak = values.length ? Math.max(...values) : undefined;
        const minimum = values.length ? Math.min(...values) : undefined;
        return (
          <StructuredListRow key={item.label}>
            <StructuredListCell head>{item.label}</StructuredListCell>
            <StructuredListCell>{current == null ? "—" : formatValue(item, current, valueFormatter)}</StructuredListCell>
            <StructuredListCell>{peak == null ? "—" : `峰值 ${formatValue(item, peak, valueFormatter)}`}</StructuredListCell>
            <StructuredListCell>{minimum == null ? "—" : `最低 ${formatValue(item, minimum, valueFormatter)}`}</StructuredListCell>
          </StructuredListRow>
        );
      })}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

function MeterView({ item, valueFormatter, fixedMaxValue }: { item: TelemetrySeries; valueFormatter: (value: number) => string; fixedMaxValue?: number }) {
  const value = currentValue(item) ?? 0;
  const max = Math.max(fixedMaxValue ?? 0, ...item.points.map((point) => point.value).filter((point) => Number.isFinite(point)), 1);
  const ratio = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="telemetry-meter" aria-label={`${item.label} ${valueFormatter(value)}`}>
      <div className="telemetry-meter__bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="telemetry-meter__fill" style={{ width: `${ratio}%` }} />
      </div>
      <div className="telemetry-meter__legend"><span>{item.label}</span><strong>{valueFormatter(value)} / {valueFormatter(max)}</strong></div>
    </div>
  );
}

function NumberView({ series, valueFormatter }: { series: TelemetrySeries[]; valueFormatter: (value: number) => string }) {
  return (
    <div className="telemetry-number-grid">
      {series.map((item) => {
        const value = currentValue(item);
        return <div className="telemetry-number" key={item.label}><span>{item.label}</span><strong>{value == null ? "—" : formatValue(item, value, valueFormatter)}</strong></div>;
      })}
    </div>
  );
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
  const { chartPointLimit } = useWorkspace();
  const visType: WidgetVisualization = widgetConfig?.visualization ?? widgetVisualization ?? "line";
  const activeSeries = useMemo(() => series
    .map((item) => ({ ...item, points: limitSamplePoints(item.points, chartPointLimit) }))
    .filter((item) => item.points.length > 0), [chartPointLimit, series]);
  const [showDetails, setShowDetails] = useState(false);
  const primary = activeSeries[0];

  const chartCard = (
    <Surface className="telemetry-chart-card">
      <div className="telemetry-chart-header">
        <div className="telemetry-chart-title"><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</div>
        {(controls || showDetailsControl) && <div className="telemetry-chart-controls">{controls}{showDetailsControl && <Button variant="quiet" className="telemetry-chart-details-btn" onClick={() => setShowDetails((value) => !value)}>{showDetails ? "返回图表" : "详细信息"}</Button>}</div>}
      </div>
      {!activeSeries.length && !content ? (
        <div className="telemetry-empty">{emptyMessage}</div>
      ) : showDetails || visType === "table" ? (
        <DetailRows series={activeSeries} valueFormatter={valueFormatter} />
      ) : content ? (
        <div className="telemetry-chart-card__content">{content}</div>
      ) : visType === "number" ? (
        <NumberView series={activeSeries} valueFormatter={valueFormatter} />
      ) : visType === "donut" ? (
        primary ? <MeterView item={primary} valueFormatter={valueFormatter} fixedMaxValue={fixedMaxValue} /> : <div className="telemetry-empty">{emptyMessage}</div>
      ) : (
        <CarbonTimeSeriesChart series={activeSeries} visualization={visType === "area" || visType === "bar" ? visType : "line"} />
      )}
      {(footer || showDetails) && <div className="telemetry-chart-card__details">{footer && <div className="telemetry-chart-card__footer">{footer}</div>}</div>}
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
  compact = false
}: {
  points: SamplePoint[];
  label: string;
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  compact?: boolean;
}) {
  return <WorkspaceTrend points={points} label={label} valueFormatter={valueFormatter} compact={compact} />;
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
      <div className="telemetry-chart-header"><div className="telemetry-chart-title"><h3>{title}</h3>{subtitle && <span>{subtitle}</span>}</div></div>
      <StructuredListWrapper className="telemetry-info-card__rows" aria-label={`${title}详情`} isCondensed isFlush><StructuredListBody>{rows.map((row) => <StructuredListRow key={row.label}><StructuredListCell head>{row.label}</StructuredListCell><StructuredListCell>{row.value}</StructuredListCell></StructuredListRow>)}</StructuredListBody></StructuredListWrapper>
    </Surface>
  );
  return widgetId ? (
    <DesktopWidget id={widgetId} templateId={widgetTemplateId} groupId={widgetGroupId} title={title} kind="content" defaultSize={widgetDefaultSize} widgetType={widgetType} category={widgetCategory} visualization="table" config={{ ...widgetConfig, visualization: "table" }}>{card}</DesktopWidget>
  ) : card;
}

export function WorkspaceTrend({
  points,
  label = "指标",
  valueFormatter = (value) => `${Math.round(value)}%`,
  compact = false
}: {
  points: SamplePoint[];
  label?: string;
  valueFormatter?: (value: number) => string;
  fixedMaxValue?: number;
  compact?: boolean;
}) {
  const { chartPointLimit } = useWorkspace();
  const chartPoints = useMemo(() => limitSamplePoints(points, chartPointLimit), [chartPointLimit, points]);
  if (!chartPoints.length) return <div className={`workspace-trend workspace-trend--empty${compact ? " workspace-trend--compact" : ""}`} aria-label={label} role="img"><div className="workspace-trend-empty">等待足够的遥测样本</div></div>;
  return (
    <div className={`workspace-trend${compact ? " workspace-trend--compact" : ""}`} aria-label={`${label}时间趋势`} role="img">
      {!compact && <div className="workspace-trend__readout"><span>Carbon Charts · 时间序列</span><strong>{label}</strong></div>}
      <CarbonTimeSeriesChart series={[{ label, points: chartPoints, valueFormatter }]} compact={compact} />
    </div>
  );
}
