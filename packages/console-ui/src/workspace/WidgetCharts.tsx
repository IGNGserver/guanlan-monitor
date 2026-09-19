import React, { useMemo } from "react";
import type { WidgetVisualization } from "@dsc/shared";
import type { WidgetLine } from "../helpers/widgetLines";
import { formatNumber, latestValue } from "./widgetChartValues";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const chartColors = ["#3b82f6", "#14b8a6", "#f59e0b", "#a78bfa", "#f97316"];

function buildChartData(lines: WidgetLine[]): Array<Record<string, string | number>> {
  const rows = new Map<string, Record<string, string | number>>();
  lines.forEach((line, lineIndex) => {
    (Array.isArray(line.points) ? line.points : []).forEach((point) => {
      const timestamp = Date.parse(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) return;
      const bucketTimestamp = Math.round(timestamp / 1000) * 1000;
      const normalizedTimestamp = new Date(bucketTimestamp).toISOString();
      const row = rows.get(normalizedTimestamp) ?? { timestamp: normalizedTimestamp };
      row[`value${lineIndex}`] = point.value;
      rows.set(normalizedTimestamp, row);
    });
  });
  return [...rows.values()].sort((left, right) => Date.parse(String(left.timestamp)) - Date.parse(String(right.timestamp)));
}

function formatTimeTick(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function chartTooltipFormatter(value: unknown, name: unknown, lines: WidgetLine[]): [string, string] {
  const numeric = typeof value === "number" ? value : Number(value);
  const index = typeof name === "string" ? Number(name.replace("value", "")) : 0;
  const line = lines[index];
  return [line?.formatter ? line.formatter(numeric) : formatNumber(numeric), line?.label ?? "数值"];
}

export function TrendChart({ lines, visualization, valueFormatter }: { lines: WidgetLine[]; visualization: WidgetVisualization; valueFormatter?: (value: number) => string }) {
  const data = useMemo(() => buildChartData(lines), [lines]);
  if (!data.length) return <div className="workspace-dynamic-empty__inline">当前时间范围没有可用数据</div>;
  if (visualization === "number") {
    return (
      <div className="workspace-dynamic-number-grid">
        {lines.map((line, index) => {
          const value = latestValue(line.points);
          return <div className="workspace-dynamic-number" key={line.label}><span>{line.label}</span><strong>{value == null ? "—" : valueFormatter?.(value) ?? line.formatter?.(value) ?? formatNumber(value)}</strong></div>;
        })}
      </div>
    );
  }
  const common = { data, margin: { top: 8, right: 10, bottom: 0, left: -16 } };
  return (
    <div className="workspace-dynamic-chart">
      <ResponsiveContainer width="100%" height="100%">
        {visualization === "bar" ? (
          <BarChart {...common}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, .22)" />
            <XAxis dataKey="timestamp" tickFormatter={formatTimeTick} minTickGap={28} />
            <YAxis tickFormatter={(value) => valueFormatter?.(Number(value)) ?? formatNumber(Number(value))} width={48} />
            <Tooltip formatter={(value, name) => chartTooltipFormatter(value, name, lines)} labelFormatter={(value) => formatTimeTick(String(value))} />
            {lines.map((line, index) => <Bar key={line.label} dataKey={`value${index}`} name={`value${index}`} fill={chartColors[index % chartColors.length]} radius={[3, 3, 0, 0]} />)}
          </BarChart>
        ) : visualization === "area" ? (
          <AreaChart {...common}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, .22)" />
            <XAxis dataKey="timestamp" tickFormatter={formatTimeTick} minTickGap={28} />
            <YAxis tickFormatter={(value) => valueFormatter?.(Number(value)) ?? formatNumber(Number(value))} width={48} />
            <Tooltip formatter={(value, name) => chartTooltipFormatter(value, name, lines)} labelFormatter={(value) => formatTimeTick(String(value))} />
            {lines.map((line, index) => <Area key={line.label} type="monotone" dataKey={`value${index}`} name={`value${index}`} stroke={chartColors[index % chartColors.length]} fill={chartColors[index % chartColors.length]} fillOpacity={0.16} strokeWidth={2} />)}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, .22)" />
            <XAxis dataKey="timestamp" tickFormatter={formatTimeTick} minTickGap={28} />
            <YAxis tickFormatter={(value) => valueFormatter?.(Number(value)) ?? formatNumber(Number(value))} width={48} />
            <Tooltip formatter={(value, name) => chartTooltipFormatter(value, name, lines)} labelFormatter={(value) => formatTimeTick(String(value))} />
            {lines.map((line, index) => <Line key={line.label} type="monotone" dataKey={`value${index}`} name={`value${index}`} stroke={chartColors[index % chartColors.length]} dot={false} strokeWidth={2} />)}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data, centerLabel, valueFormatter = (value) => formatNumber(value) }: { data: Array<{ name: string; value: number; color: string }>; centerLabel?: string; valueFormatter?: (value: number) => string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <div className="workspace-dynamic-empty__inline">暂无可用于构成图的数据</div>;
  return (
    <div className="workspace-dynamic-donut-wrap">
      <div className="workspace-dynamic-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={3} stroke="none">
              {data.map((item) => <Cell key={item.name} fill={item.color} />)}
            </Pie>
            <Tooltip formatter={(value, name) => [valueFormatter(Number(value)), String(name)]} />
          </PieChart>
        </ResponsiveContainer>
        <span>{centerLabel ?? `${Math.round(total)}`}</span>
      </div>
      <div className="workspace-dynamic-legend">{data.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name} {valueFormatter(item.value)}</span>)}</div>
    </div>
  );
}
