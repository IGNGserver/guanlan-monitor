import React, { useMemo } from "react";
import type { WidgetVisualization } from "@dsc/shared";
import type { WidgetLine } from "../helpers/widgetLines";
import { CarbonTimeSeriesChart } from "./CarbonCharts";
import { formatNumber, latestValue } from "./widgetChartValues";

export function TrendChart({ lines, visualization, valueFormatter }: { lines: WidgetLine[]; visualization: WidgetVisualization; valueFormatter?: (value: number) => string }) {
  const series = useMemo(() => lines.map((line) => ({ label: line.label, points: line.points, valueFormatter: line.formatter })), [lines]);
  const hasData = series.some((line) => line.points.some((point) => Number.isFinite(Date.parse(point.timestamp)) && Number.isFinite(point.value)));
  if (!hasData) return <div className="workspace-dynamic-empty__inline">当前时间范围没有可用数据</div>;
  if (visualization === "number") {
    return (
      <div className="workspace-dynamic-number-grid">
        {lines.map((line) => {
          const value = latestValue(line.points);
          return <div className="workspace-dynamic-number" key={line.label}><span>{line.label}</span><strong>{value == null ? "—" : valueFormatter?.(value) ?? line.formatter?.(value) ?? formatNumber(value)}</strong></div>;
        })}
      </div>
    );
  }
  return <CarbonTimeSeriesChart series={series} visualization={visualization === "area" || visualization === "bar" ? visualization : "line"} />;
}

export function CompositionMeter({ data, centerLabel, valueFormatter = (value) => formatNumber(value) }: { data: Array<{ name: string; value: number; color: string }>; centerLabel?: string; valueFormatter?: (value: number) => string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const max = Math.max(total, 1);
  if (!total) return <div className="workspace-dynamic-empty__inline">暂无可用于构成图的数据</div>;
  return (
    <div className="workspace-dynamic-meter-wrap" aria-label={centerLabel ?? `总量 ${valueFormatter(total)}`}>
      <div className="workspace-dynamic-meter" role="img" aria-label="构成比例">
        {data.map((item) => <span key={item.name} style={{ width: `${Math.max(0, item.value / max) * 100}%`, background: item.color }} title={`${item.name} ${valueFormatter(item.value)}`} />)}
      </div>
      <div className="workspace-dynamic-meter__summary"><strong>{centerLabel ?? valueFormatter(total)}</strong><span>总量</span></div>
      <div className="workspace-dynamic-legend">{data.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name} {valueFormatter(item.value)}</span>)}</div>
    </div>
  );
}
