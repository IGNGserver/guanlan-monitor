import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceSummary,
  DiskDeviceStats,
  MetricsLatest,
  MetricsResponse,
  SamplePoint,
  TemperatureMetricSeries,
  TemperatureSensorReading,
  WidgetLayoutCatalogEntry,
  WidgetInstanceConfig,
  WidgetVisualization
} from "@dsc/shared";
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
import { DesktopWidget, useWidgetLayout, type WidgetGroupChildDefinition, type WidgetKind, type WidgetSize } from "./WidgetLayout";
import { DeviceWidgetFrame } from "./DeviceWidgetFrame";
import { getWidgetLines, averageSamplePoints, type WidgetLine } from "../helpers/widgetLines";
import { UNAVAILABLE_METRIC_LABEL } from "./formatters";

type WidgetCatalogDefinition = {
  widgetType: string;
  title: string;
  description: string;
  category: string;
  kind: WidgetKind;
  defaultSize: WidgetSize;
  visualization: WidgetVisualization;
  visualizations: WidgetVisualization[];
  requires?: DeviceMetricKey[];
  targetKind?: WidgetTargetKind;
  deviceGroup?: boolean;
};

type WidgetTargetKind = "cpu" | "disk" | "gpu" | "fan" | "network" | "temperature";

type WidgetCatalogContext = {
  device: DeviceSummary;
  metrics: MetricsResponse | null;
  localTemperatureSources?: TemperatureSensorReading[];
  localTemperatureSourcesAt?: string | null;
};

const visualizationLabels: Record<WidgetVisualization, string> = {
  line: "折线图",
  area: "面积图",
  bar: "条形图",
  donut: "环形图",
  number: "纯数据显示",
  table: "数据表格"
};

const chartColors = ["#3b82f6", "#14b8a6", "#f59e0b", "#a78bfa", "#f97316"];

export const WIDGET_CATALOG: WidgetCatalogDefinition[] = [
  {
    widgetType: "cpu-device-group",
    title: "处理器设备组",
    description: "一次添加指定处理器的使用率、主频和温度图表；组内图表仍可单独移除。",
    category: "设备组",
    kind: "group",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table"],
    targetKind: "cpu",
    deviceGroup: true
  },
  {
    widgetType: "disk-device-group",
    title: "磁盘设备组",
    description: "一次添加指定磁盘的容量、读写和 SMART 图表；组内图表仍可单独移除。",
    category: "设备组",
    kind: "group",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table"],
    targetKind: "disk",
    deviceGroup: true
  },
  {
    widgetType: "gpu-device-group",
    title: "显卡设备组",
    description: "一次添加指定显卡的核心、编码、解码、频率、内存、温度和驱动信息；组内图表仍可单独移除。",
    category: "设备组",
    kind: "group",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table"],
    targetKind: "gpu",
    deviceGroup: true
  },
  {
    widgetType: "network-device-group",
    title: "网卡设备组",
    description: "一次添加指定网卡的收发吞吐图表；组内图表仍可单独移除。",
    category: "设备组",
    kind: "group",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table"],
    targetKind: "network",
    deviceGroup: true
  },
  {
    widgetType: "fan-device-group",
    title: "风扇设备组",
    description: "一次添加指定风扇的转速图表；组内图表仍可单独移除。",
    category: "设备组",
    kind: "group",
    defaultSize: "small",
    visualization: "table",
    visualizations: ["table"],
    targetKind: "fan",
    deviceGroup: true
  },
  {
    widgetType: "hardware-system",
    title: "硬件与系统",
    description: "设备身份、操作系统、运行时间和硬件摘要。",
    category: "系统",
    kind: "group",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table"]
  },
  {
    widgetType: "cpu-usage",
    title: "CPU 使用率 (折线图)",
    description: "处理器核心负载实时变化与历史趋势。",
    category: "处理器",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["cpuUsage"],
    targetKind: "cpu"
  },
  {
    widgetType: "cpu-usage-pie",
    title: "CPU 使用率 (饼图)",
    description: "当前处理器核心负载占用环形饼图。",
    category: "处理器",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut", "number"],
    requires: ["cpuUsage"],
    targetKind: "cpu"
  },
  {
    widgetType: "cpu-frequency",
    title: "CPU 主频",
    description: "指定处理器的实时有效频率趋势。",
    category: "处理器",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["cpuFrequency"],
    targetKind: "cpu"
  },
  {
    widgetType: "cpu-temperature",
    title: "CPU 温度",
    description: "指定处理器的 Package/Core 温度趋势。",
    category: "处理器",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["cpuTemperature"],
    targetKind: "cpu"
  },
  {
    widgetType: "memory-usage",
    title: "内存使用 (折线图)",
    description: "物理内存和提交内存的使用趋势与当前占用。",
    category: "内存",
    kind: "content",
    defaultSize: "large",
    visualization: "area",
    visualizations: ["area", "line", "bar", "number"],
    requires: ["memoryUsage"]
  },
  {
    widgetType: "memory-usage-pie",
    title: "内存使用 (饼图)",
    description: "当前物理内存已用与剩余空间环形饼图。",
    category: "内存",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut", "number"],
    requires: ["memoryUsage"]
  },
  {
    widgetType: "disk-capacity",
    title: "磁盘容量 (折线图)",
    description: "磁盘已用容量历史变化趋势。",
    category: "存储",
    kind: "content",
    defaultSize: "medium",
    visualization: "area",
    visualizations: ["area", "line", "bar", "number"],
    requires: ["diskUsage"],
    targetKind: "disk"
  },
  {
    widgetType: "disk-capacity-pie",
    title: "磁盘容量 (饼图)",
    description: "指定磁盘当前已用与剩余空间环形饼图。",
    category: "存储",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut", "number"],
    requires: ["diskUsage"],
    targetKind: "disk"
  },
  {
    widgetType: "disk-io",
    title: "磁盘读写速率",
    description: "指定磁盘的读取与写入速率趋势。",
    category: "存储",
    kind: "content",
    defaultSize: "large",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["diskRead", "diskWrite"],
    targetKind: "disk"
  },
  {
    widgetType: "disk-health",
    title: "磁盘健康与 SMART",
    description: "显示磁盘健康状态、温度、寿命与已采集的 SMART 属性。",
    category: "存储",
    kind: "content",
    defaultSize: "large",
    visualization: "table",
    visualizations: ["table", "donut", "number"],
    requires: ["diskHealth"],
    targetKind: "disk"
  },
  {
    widgetType: "network-throughput",
    title: "网络吞吐",
    description: "网卡接收与发送速率，支持多种图表形式。",
    category: "网络",
    kind: "content",
    defaultSize: "large",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["networkRxRate", "networkTxRate"],
    targetKind: "network"
  },
  {
    widgetType: "gpu-load",
    title: "GPU 负载 (折线图)",
    description: "显卡核心负载历史变化趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["gpuUsage"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-load-pie",
    title: "GPU 负载 (饼图)",
    description: "当前显卡核心负载占用环形饼图。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut", "number"],
    requires: ["gpuUsage"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-encode",
    title: "GPU 编码负载",
    description: "指定显卡的视频编码引擎负载趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["gpuEncode"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-decode",
    title: "GPU 解码负载",
    description: "指定显卡的视频解码引擎负载趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["gpuDecode"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-frequency",
    title: "GPU 频率",
    description: "指定显卡核心时钟频率的实时趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["gpuFrequency"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-memory",
    title: "GPU 内存使用 (折线图)",
    description: "指定显卡的独立显存或共享显存已用容量历史趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "area",
    visualizations: ["area", "line", "bar", "number"],
    requires: ["gpuMemory"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-memory-pie",
    title: "GPU 内存使用 (饼图)",
    description: "当前独立显存或共享显存已用与容量环形饼图。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut", "number"],
    requires: ["gpuMemory"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-temperature",
    title: "GPU 温度",
    description: "指定显卡的传感器温度趋势。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["gpuTemperature"],
    targetKind: "gpu"
  },
  {
    widgetType: "gpu-driver",
    title: "GPU 驱动信息",
    description: "显示显卡适配器和驱动版本等硬件信息。",
    category: "显卡",
    kind: "content",
    defaultSize: "medium",
    visualization: "table",
    visualizations: ["table"],
    requires: ["gpuDriverInfo"],
    targetKind: "gpu"
  },
  {
    widgetType: "temperature-source-line",
    title: "温度源 (折线图)",
    description: "选择一个具体温度传感器，查看它的当前值和历史变化趋势。",
    category: "温度",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line"],
    requires: ["temperatureSources"],
    targetKind: "temperature"
  },
  {
    widgetType: "temperature-source-pie",
    title: "温度源 (饼图)",
    description: "选择一个具体温度传感器，按当前温度与高温/临界阈值展示环形饼图；没有阈值时以 100 °C 为参考。",
    category: "温度",
    kind: "content",
    defaultSize: "medium",
    visualization: "donut",
    visualizations: ["donut"],
    requires: ["temperatureSources"],
    targetKind: "temperature"
  },
  {
    widgetType: "fan-speed",
    title: "风扇转速",
    description: "风扇 RPM 趋势与当前转速。",
    category: "散热",
    kind: "content",
    defaultSize: "small",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["fanRpm"],
    targetKind: "fan"
  },
  {
    widgetType: "system-processes",
    title: "系统进程与句柄",
    description: "进程、线程、句柄等系统级计数趋势。",
    category: "系统",
    kind: "content",
    defaultSize: "medium",
    visualization: "line",
    visualizations: ["line", "area", "bar", "number"],
    requires: ["systemOverview"]
  }
];

const widgetDefinitionByType = new Map(WIDGET_CATALOG.map((definition) => [definition.widgetType, definition]));

// Keep widgets created by versions that exposed the aggregate table renderable,
// but do not offer that empty-prone aggregate as a new catalog item anymore.
const legacyTemperatureSourcesDefinition: WidgetCatalogDefinition = {
  widgetType: "temperature-sources",
  title: "全部温度源",
  description: "兼容旧版本的温度源总表；新组件应选择一个具体温度源。",
  category: "温度",
  kind: "content",
  defaultSize: "large",
  visualization: "table",
  visualizations: ["table"]
};
widgetDefinitionByType.set(legacyTemperatureSourcesDefinition.widgetType, legacyTemperatureSourcesDefinition);

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatNumber(value: number | null | undefined, suffix = ""): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("zh-CN")}${suffix}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "未采集";
  const minutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `${days ? `${days} 天 ` : ""}${hours ? `${hours} 小时 ` : ""}${rest} 分钟`;
}

function latestValue(points: SamplePoint[] | undefined): number | null {
  const point = points?.[points.length - 1];
  return point && Number.isFinite(point.value) ? point.value : null;
}

function sumSamplePoints(groups: SamplePoint[][]): SamplePoint[] {
  const buckets = new Map<number, { timestamp: string; total: number }>();
  for (const points of groups) {
    for (const point of points) {
      const timestamp = Date.parse(point.timestamp);
      if (!Number.isFinite(timestamp) || !Number.isFinite(point.value)) continue;
      const bucketTimestamp = Math.round(timestamp / 1000) * 1000;
      const current = buckets.get(bucketTimestamp) ?? { timestamp: new Date(bucketTimestamp).toISOString(), total: 0 };
      current.total += point.value;
      buckets.set(bucketTimestamp, current);
    }
  }
  return [...buckets.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).map((point) => ({ timestamp: point.timestamp, value: point.total }));
}


function metricAvailable(definition: WidgetCatalogDefinition, metrics: MetricsResponse | null, localTemperatureSources: TemperatureSensorReading[] = []): boolean {
  if (definition.targetKind === "temperature" && localTemperatureSources.some((sensor) => sensor.currentC != null && Number.isFinite(sensor.currentC))) return true;
  if (!definition.requires?.length || !metrics) return true;
  return definition.requires.some((key) => metrics.enabledMetrics.includes(key) || metrics.availableMetrics.some((option) => option.key === key && option.available));
}

function visualizationFor(entry: WidgetLayoutCatalogEntry, definition: WidgetCatalogDefinition): WidgetVisualization {
  const candidate = entry.config?.visualization ?? entry.visualization;
  return candidate && definition.visualizations.includes(candidate) ? candidate : definition.visualization;
}


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

function TrendChart({ lines, visualization, valueFormatter }: { lines: WidgetLine[]; visualization: WidgetVisualization; valueFormatter?: (value: number) => string }) {
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

function DonutChart({ data, centerLabel, valueFormatter = (value) => formatNumber(value) }: { data: Array<{ name: string; value: number; color: string }>; centerLabel?: string; valueFormatter?: (value: number) => string }) {
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

function DataTable({ rows }: { rows: Array<{ label: string; value: string; detail?: string; tone?: "good" | "warn" | "muted" }> }) {
  if (!rows.length) return <div className="workspace-dynamic-empty__inline">暂无数据</div>;
  return <div className="workspace-dynamic-table">{rows.map((row) => <div className="workspace-dynamic-table__row" key={`${row.label}-${row.value}`}><span>{row.label}</span><strong className={row.tone ? `is-${row.tone}` : ""}>{row.value}</strong>{row.detail && <small>{row.detail}</small>}</div>)}</div>;
}

function diskHealthTone(status: string | null | undefined): "good" | "warn" | "muted" {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("good") || normalized.includes("pass") || normalized.includes("healthy") || normalized.includes("正常")) return "good";
  if (normalized.includes("bad") || normalized.includes("fail") || normalized.includes("warn") || normalized.includes("异常")) return "warn";
  return "muted";
}

function getTargetId(entry: WidgetLayoutCatalogEntry): string | undefined {
  const target = entry.config?.targetId;
  return typeof target === "string" ? target : undefined;
}

function unavailableMetricForWidget(widgetType: string): DeviceMetricKey | undefined {
  if (widgetType === "cpu-usage" || widgetType === "cpu-usage-pie") return "cpuUsage";
  if (widgetType === "cpu-frequency") return "cpuFrequency";
  if (widgetType === "cpu-temperature") return "cpuTemperature";
  if (widgetType === "memory-usage" || widgetType === "memory-usage-pie") return "memoryUsage";
  if (widgetType === "disk-capacity" || widgetType === "disk-capacity-pie") return "diskUsage";
  if (widgetType === "disk-io") return "diskRead";
  if (widgetType === "network-throughput") return "networkRxRate";
  if (widgetType === "system-processes") return "systemOverview";
  return undefined;
}

function metricUnavailable(metrics: MetricsResponse | null, key: DeviceMetricKey | undefined, device?: DeviceSummary): boolean {
  if (!key) return false;
  return new Set([...(device?.unavailableMetrics ?? []), ...(metrics?.latest.unavailableMetrics ?? [])]).has(key);
}

function gpuMemoryLabel(memoryKind: string | null | undefined): string {
  if (memoryKind === "shared") return "共享显存";
  if (memoryKind === "dedicated") return "独立显存";
  return "GPU 内存";
}


function hardwareRows(device: DeviceSummary, latest: MetricsLatest | undefined): Array<{ label: string; value: string; detail?: string }> {
  const cpus = latest?.cpuPackages ?? [];
  const unavailable = new Set([...(device.unavailableMetrics ?? []), ...(latest?.unavailableMetrics ?? [])]);
  return [
    { label: "操作系统", value: device.os },
    { label: "设备 ID", value: device.deviceId },
    { label: "Agent", value: device.agentVersion ? `v${device.agentVersion}` : "未知" },
    {
      label: "CPU",
      value: cpus.length ? cpus.map((cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex} · ` : ""}${cpu.model || cpu.name || "未命名"}`).join(" / ") : "未采集",
      detail: cpus.length ? cpus.map((cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex} ` : ""}${cpu.coreCount ?? "?"} 核 · ${cpu.logicalCount ?? "?"} 线程`).join(" / ") : undefined
    },
    { label: "运行时间", value: unavailable.has("systemOverview") ? UNAVAILABLE_METRIC_LABEL : formatDuration(latest?.system.uptimeSeconds) },
    { label: "内存", value: unavailable.has("memoryUsage") ? `${UNAVAILABLE_METRIC_LABEL}${latest?.memoryTotalBytes ? ` · 总容量 ${formatBytes(latest.memoryTotalBytes)}` : ""}` : latest ? `${formatBytes(latest.memoryUsedBytes)} / ${formatBytes(latest.memoryTotalBytes)}` : "未采集" },
    { label: "磁盘", value: unavailable.has("diskUsage") ? `${UNAVAILABLE_METRIC_LABEL}${latest?.diskTotalBytes ? ` · 总容量 ${formatBytes(latest.diskTotalBytes)}` : ""}` : latest ? `${formatBytes(latest.diskUsedBytes)} / ${formatBytes(latest.diskTotalBytes)}` : "未采集" }
  ];
}

function diskRows(disks: DiskDeviceStats[]): Array<{ label: string; value: string; detail?: string; tone?: "good" | "warn" | "muted" }> {
  return disks.flatMap((disk) => {
    const status = disk.healthStatus || "未报告";
    const attributes = disk.smartAttributes?.length ? `SMART ${disk.smartAttributes.length} 项` : "暂无 SMART 属性";
    return [{ label: disk.model || disk.name || disk.id, value: status, detail: [disk.mountPoint, disk.temperatureC != null ? `${Math.round(disk.temperatureC)} °C` : "温度—", disk.healthPercent != null ? `寿命 ${Math.round(disk.healthPercent)}%` : "寿命—", attributes].filter(Boolean).join(" · "), tone: diskHealthTone(disk.healthStatus) }];
  });
}

function temperatureRows(sensors: TemperatureSensorReading[]): Array<{ label: string; value: string; detail?: string; tone?: "good" | "warn" | "muted" }> {
  return sensors.map((sensor) => {
    const current = sensor.currentC != null && Number.isFinite(sensor.currentC) ? `${sensor.currentC.toFixed(1)} °C` : "—";
    const status = sensor.status === "valid" ? "正常" : sensor.status === "threshold" ? "阈值" : sensor.status === "invalid" ? "无效值" : "不可用";
    const tone: "good" | "warn" | "muted" = sensor.status === "valid" ? "good" : sensor.status === "threshold" || sensor.status === "invalid" ? "warn" : "muted";
    return {
      label: sensor.displayName || sensor.rawName,
      value: `${current} · ${status}`,
      detail: [sensor.role, sensor.source, sensor.backend, sensor.hardware, sensor.path].filter(Boolean).join(" · "),
      tone
    };
  });
}

function temperatureRowsFromSeries(sensors: TemperatureMetricSeries[]): Array<{ label: string; value: string; detail?: string; tone?: "good" | "warn" | "muted" }> {
  return sensors.map((sensor) => {
    const current = latestValue(sensor.currentC);
    const status = sensor.status === "valid" ? "正常" : sensor.status === "threshold" ? "阈值" : sensor.status === "invalid" ? "无效值" : "不可用";
    const tone: "good" | "warn" | "muted" = sensor.status === "valid" ? "good" : sensor.status === "threshold" || sensor.status === "invalid" ? "warn" : "muted";
    return {
      label: sensor.name || sensor.rawName,
      value: `${current == null ? "—" : `${current.toFixed(1)} °C`} · ${status}`,
      detail: [sensor.role, sensor.source, sensor.backend, sensor.hardware].filter(Boolean).join(" · "),
      tone
    };
  });
}

function gpuDriverRows(gpus: MetricsLatest["gpus"], targetId?: string): Array<{ label: string; value: string; detail?: string; tone?: "good" | "warn" | "muted" }> {
  const visible = targetId ? gpus.filter((gpu) => gpu.id === targetId) : gpus;
  return visible.map((gpu) => ({
    label: gpu.name,
    value: gpu.driverVersion || "未报告",
    detail: [gpu.memoryKind === "shared" ? "共享显存" : gpu.memoryKind === "dedicated" ? "独立显存" : "GPU 内存类型未知", gpu.integrated ? "集成显卡" : "独立显卡"].join(" · "),
    tone: gpu.driverVersion ? "good" : "muted"
  }));
}

function healthDonutData(disks: DiskDeviceStats[]) {
  const good = disks.filter((disk) => diskHealthTone(disk.healthStatus) === "good").length;
  const warn = disks.filter((disk) => diskHealthTone(disk.healthStatus) === "warn").length;
  const unknown = Math.max(0, disks.length - good - warn);
  return [{ name: "正常", value: good, color: "#14b8a6" }, { name: "需要注意", value: warn, color: "#f59e0b" }, { name: "未报告", value: unknown, color: "#94a3b8" }].filter((item) => item.value > 0);
}

function WidgetContent({ definition, entry, context }: { definition: WidgetCatalogDefinition; entry: WidgetLayoutCatalogEntry; context: WidgetCatalogContext }) {
  const { device, metrics, localTemperatureSources = [], localTemperatureSourcesAt } = context;
  const latest = metrics?.latest;
  const visualization = visualizationFor(entry, definition);
  const unavailableKey = unavailableMetricForWidget(definition.widgetType);
  if (metricUnavailable(metrics, unavailableKey, device)) {
    return <div className="workspace-dynamic-empty__inline">{UNAVAILABLE_METRIC_LABEL}</div>;
  }
  if (definition.widgetType === "hardware-system") return <DataTable rows={hardwareRows(device, latest)} />;
  if (definition.widgetType === "temperature-sources") {
    const latestSensors = latest?.temperatureSensors ?? [];
    return <DataTable rows={latestSensors.length ? temperatureRows(latestSensors) : temperatureRowsFromSeries(metrics?.series.temperatureSensors ?? [])} />;
  }
  if (definition.widgetType === "gpu-driver") {
    const targetId = getTargetId(entry);
    return <DataTable rows={gpuDriverRows(latest?.gpus ?? [], targetId)} />;
  }
  if (definition.widgetType === "disk-health") {
    const targetId = getTargetId(entry);
    const allDisks = latest?.disks ?? [];
    const disks = targetId ? allDisks.filter((disk) => disk.id === targetId) : allDisks;
    if (visualization === "donut") return <DonutChart data={healthDonutData(disks)} centerLabel={`${disks.length} 盘`} />;
    if (visualization === "number") {
      const healthy = disks.filter((disk) => diskHealthTone(disk.healthStatus) === "good").length;
      return <div className="workspace-dynamic-number-grid"><div className="workspace-dynamic-number"><span>健康磁盘</span><strong>{healthy} / {disks.length}</strong></div><div className="workspace-dynamic-number"><span>SMART 属性</span><strong>{disks.reduce((sum, disk) => sum + (disk.smartAttributes?.length ?? 0), 0)}</strong></div></div>;
    }
    return <DataTable rows={diskRows(disks)} />;
  }
  if ((definition.widgetType === "cpu-usage" || definition.widgetType === "cpu-usage-pie") && visualization === "donut") {
    const targetId = getTargetId(entry);
    const cpu = targetId ? latest?.cpuPackages?.find((item) => item.id === targetId) : latest?.cpuPackages?.[0];
    const used = cpu?.usagePercent ?? (targetId && (latest?.cpuPackages?.length ?? 0) > 1 ? undefined : latestValue(metrics?.series.cpuUsagePercent));
    if (used == null || !Number.isFinite(used)) return <div className="workspace-dynamic-empty__inline">{UNAVAILABLE_METRIC_LABEL}</div>;
    return <DonutChart data={[{ name: "已用", value: Math.min(100, Math.max(0, used)), color: "#3b82f6" }, { name: "空闲", value: Math.max(0, 100 - used), color: "#cbd5e1" }]} centerLabel={`${Math.round(used)}%`} />;
  }
  if ((definition.widgetType === "memory-usage" || definition.widgetType === "memory-usage-pie") && visualization === "donut") {
    const used = latest?.memoryUsedBytes ?? 0;
    const total = latest?.memoryTotalBytes ?? 0;
    return <DonutChart data={[{ name: "已用", value: Math.max(0, used), color: "#14b8a6" }, { name: "空闲", value: Math.max(0, total - used), color: "#cbd5e1" }]} centerLabel={total ? `${Math.round((used / total) * 100)}%` : "—"} />;
  }
  if ((definition.widgetType === "disk-capacity" || definition.widgetType === "disk-capacity-pie") && visualization === "donut") {
    const targetId = getTargetId(entry);
    const disk = targetId ? latest?.disks?.find((item) => item.id === targetId) : undefined;
    const used = disk?.usedBytes ?? latest?.diskUsedBytes ?? 0;
    const total = disk?.totalBytes ?? latest?.diskTotalBytes ?? 0;
    return <DonutChart data={[{ name: "已用", value: Math.max(0, used), color: "#3b82f6" }, { name: "剩余", value: Math.max(0, total - used), color: "#cbd5e1" }]} centerLabel={total ? `${Math.round((used / total) * 100)}%` : "—"} />;
  }
  if ((definition.widgetType === "gpu-load" || definition.widgetType === "gpu-load-pie") && visualization === "donut") {
    const targetId = getTargetId(entry);
    const gpu = targetId ? latest?.gpus?.find((item) => item.id === targetId) : latest?.gpus?.[0];
    const used = gpu?.utilizationPercent ?? latestValue(metrics?.series.gpuUsagePercent) ?? 0;
    return <DonutChart data={[{ name: "负载", value: Math.min(100, Math.max(0, used)), color: "#f59e0b" }, { name: "空闲", value: Math.max(0, 100 - used), color: "#cbd5e1" }]} centerLabel={`${Math.round(used)}%`} />;
  }
  if ((definition.widgetType === "gpu-memory" || definition.widgetType === "gpu-memory-pie") && visualization === "donut") {
    const targetId = getTargetId(entry);
    const gpu = targetId ? latest?.gpus?.find((item) => item.id === targetId) : latest?.gpus?.[0];
    const used = gpu?.memoryUsedBytes ?? 0;
    const total = gpu?.memoryTotalBytes ?? 0;
    const memoryLabel = gpuMemoryLabel(gpu?.memoryKind);
    return <DonutChart data={[{ name: `${memoryLabel}已用`, value: Math.max(0, used), color: "#a78bfa" }, { name: `${memoryLabel}剩余`, value: Math.max(0, total - used), color: "#cbd5e1" }]} centerLabel={total ? `${Math.round((used / total) * 100)}%` : "—"} />;
  }
  if (definition.widgetType === "temperature-source-pie" && visualization === "donut") {
    const targetId = getTargetId(entry);
    const latestSensor = targetId ? latest?.temperatureSensors?.find((sensor) => sensor.id === targetId) : undefined;
    const seriesSensor = targetId ? metrics?.series.temperatureSensors?.find((sensor) => sensor.id === targetId) : undefined;
    const localSensor = targetId ? localTemperatureSources.find((sensor) => sensor.id === targetId) : undefined;
    const current = latestSensor?.currentC ?? localSensor?.currentC ?? latestValue(seriesSensor?.currentC);
    if (current == null || !Number.isFinite(current)) return <div className="workspace-dynamic-empty__inline">当前时间范围没有可用的温度数据</div>;
    const configuredLimit = latestSensor?.criticalC ?? localSensor?.criticalC ?? seriesSensor?.criticalC ?? latestSensor?.highC ?? localSensor?.highC ?? seriesSensor?.highC;
    const limit = Math.max(0, current, configuredLimit ?? 100);
    const displayCurrent = Math.max(0, current);
    const limitLabel = configuredLimit != null ? "温度上限余量" : "参考温度余量";
    return <DonutChart data={[{ name: "当前温度", value: displayCurrent, color: "#f59e0b" }, { name: limitLabel, value: Math.max(0, limit - displayCurrent), color: "#cbd5e1" }]} centerLabel={`${current.toFixed(1)} °C`} valueFormatter={(value) => `${value.toFixed(1)} °C`} />;
  }
  const { lines, valueFormatter } = getWidgetLines(definition.widgetType, metrics, getTargetId(entry), localTemperatureSources, localTemperatureSourcesAt);
  return <TrendChart lines={lines} visualization={visualization} valueFormatter={valueFormatter} />;
}

function targetOptions(definition: WidgetCatalogDefinition, metrics: MetricsResponse | null, localTemperatureSources: TemperatureSensorReading[] = []): Array<{ id: string; name: string; detail?: string }> {
  if (!definition.targetKind) return [];
  const filterEnabled = <T extends { id: string }>(items: T[], blockKey?: DeviceBlockKey) => {
    if (!metrics) return [];
    const enabledIds = blockKey ? metrics.enabledDeviceIds?.[blockKey] : undefined;
    return Array.isArray(enabledIds) ? items.filter((item) => enabledIds.includes(item.id)) : items;
  };
  if (definition.targetKind === "temperature") {
    const latestById = new Map((metrics?.latest?.temperatureSensors ?? []).map((sensor) => [sensor.id, sensor]));
    const localById = new Map(localTemperatureSources.map((sensor) => [sensor.id, sensor]));
    const seen = new Set<string>();
    const targets: Array<{ id: string; name: string; detail?: string }> = [];
    for (const sensor of metrics?.series.temperatureSensors ?? []) {
      const latestSensor = latestById.get(sensor.id);
      const localSensor = localById.get(sensor.id);
      const hasHistory = sensor.currentC.some((point) => Number.isFinite(point.value));
      const hasCurrent = [latestSensor?.currentC, localSensor?.currentC].some((value) => value != null && Number.isFinite(value));
      if (!hasHistory && !hasCurrent) continue;
      seen.add(sensor.id);
      targets.push({
        id: sensor.id,
        name: latestSensor?.displayName || localSensor?.displayName || sensor.name || latestSensor?.rawName || localSensor?.rawName || sensor.rawName,
        detail: [sensor.role, sensor.source, sensor.backend, sensor.hardware].filter(Boolean).join(" · ")
      });
    }
    for (const sensor of metrics?.latest?.temperatureSensors ?? []) {
      if (seen.has(sensor.id) || sensor.currentC == null || !Number.isFinite(sensor.currentC)) continue;
      seen.add(sensor.id);
      targets.push({
        id: sensor.id,
        name: sensor.displayName || sensor.rawName,
        detail: [sensor.role, sensor.source, sensor.backend, sensor.hardware, sensor.path].filter(Boolean).join(" · ")
      });
    }
    for (const sensor of localTemperatureSources) {
      if (seen.has(sensor.id) || sensor.currentC == null || !Number.isFinite(sensor.currentC)) continue;
      seen.add(sensor.id);
      targets.push({
        id: sensor.id,
        name: sensor.displayName || sensor.rawName || sensor.id,
        detail: [sensor.role, sensor.source, sensor.backend, sensor.hardware, sensor.path].filter(Boolean).join(" · ")
      });
    }
    return targets;
  }
  if (!metrics) return [];
  if (definition.targetKind === "cpu") return filterEnabled(metrics.series.cpus ?? [], "cpu").map((item) => ({
    id: item.id,
    name: item.socketIndex != null ? `Socket ${item.socketIndex}` : item.id,
    detail: `${item.socketIndex != null ? `Socket ${item.socketIndex} · ` : ""}${item.model || item.name}`
  }));
  if (definition.targetKind === "disk") return filterEnabled(metrics.series.disks ?? [], "disk").map((item) => ({ id: item.id, name: item.model || item.name, detail: item.mountPoint }));
  if (definition.targetKind === "gpu") return filterEnabled(metrics.series.gpus ?? [], "gpu").map((item) => ({ id: item.id, name: item.name }));
  if (definition.targetKind === "fan") {
    const seriesFans = filterEnabled(metrics.series.fans ?? [], "fan");
    const latestFans = filterEnabled(metrics.latest.fans ?? [], "fan");
    const latestById = new Map(latestFans.map((item) => [item.id, item]));
    const targets = seriesFans.map((item) => ({
      id: item.id,
      name: latestById.get(item.id)?.label || item.name,
      detail: latestById.get(item.id)?.interface || item.interface
    }));
    const seen = new Set(targets.map((item) => item.id));
    latestFans.forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      targets.push({ id: item.id, name: item.label, detail: item.interface });
    });
    return targets;
  }
  if (definition.targetKind === "network") return filterEnabled(metrics.series.networks ?? [], "network").map((item) => ({ id: item.id, name: item.model || item.name, detail: item.macAddress }));
  return [];
}

const DEVICE_GROUP_CHILD_TYPES: Record<WidgetTargetKind, string[]> = {
  cpu: ["cpu-usage", "cpu-frequency", "cpu-temperature"],
  disk: ["disk-capacity", "disk-io", "disk-health"],
  gpu: ["gpu-load", "gpu-encode", "gpu-decode", "gpu-frequency", "gpu-memory", "gpu-temperature", "gpu-driver"],
  network: ["network-throughput"],
  fan: ["fan-speed"],
  temperature: []
};

function groupChildrenForTarget(targetKind: WidgetTargetKind, target: { id: string; name: string }): WidgetGroupChildDefinition[] {
  return DEVICE_GROUP_CHILD_TYPES[targetKind]
    .map((widgetType) => widgetDefinitionByType.get(widgetType))
    .filter((definition): definition is WidgetCatalogDefinition => Boolean(definition))
    .map((definition) => ({
      title: `${definition.title} · ${target.name}`,
      kind: definition.kind,
      defaultSize: definition.defaultSize,
      widgetType: definition.widgetType,
      category: definition.category,
      visualization: definition.visualization,
      config: { visualization: definition.visualization, targetId: target.id }
    }));
}

function isDeviceGroupDefinition(definition: WidgetCatalogDefinition | undefined): boolean {
  return Boolean(definition?.deviceGroup);
}

function isSystemRenderedEntry(entry: WidgetLayoutCatalogEntry): boolean {
  return entry.config?.systemRendered === true;
}

const deviceGroupEyebrows: Record<WidgetTargetKind, string> = {
  cpu: "CPU 实例",
  disk: "硬盘实例",
  gpu: "显卡实例",
  fan: "风扇实例",
  network: "网卡实例",
  temperature: "温度源"
};

function DynamicWidgetGroupCard({ entry, children, context }: { entry: WidgetLayoutCatalogEntry & { id: string }; children: Array<WidgetLayoutCatalogEntry & { id: string }>; context: WidgetCatalogContext }) {
  const definition = widgetDefinitionByType.get(entry.widgetType ?? "");
  if (!definition) return null;
  const target = definition.targetKind
    ? targetOptions(definition, context.metrics, context.localTemperatureSources).find((item) => item.id === getTargetId(entry))
    : undefined;
  const frameTitle = target
    ? definition.targetKind === "cpu" ? target.detail || target.name : target.name
    : entry.title;
  const frameSubtitle = target && definition.targetKind !== "cpu" ? target.detail || definition.description : definition.description;
  return (
    <DesktopWidget
      id={entry.id}
      groupId={entry.groupId}
      title={frameTitle}
      kind="group"
      defaultSize={entry.defaultSize}
      widgetType={definition.widgetType}
      category={definition.category}
      visualization={entry.visualization}
      config={entry.config}
      compactH={Math.max(2, children.length * 2)}
      className="workspace-widget--device-frame"
    >
      <DeviceWidgetFrame
        kind={definition.targetKind === "temperature" ? "generic" : definition.targetKind ?? "generic"}
        eyebrow={definition.targetKind ? deviceGroupEyebrows[definition.targetKind] : "设备组"}
        title={frameTitle}
        subtitle={frameSubtitle}
        count={`${children.length} 个图表`}
        contentClassName="workspace-device-block__charts--dynamic"
      >
        {children.length ? (
          children.map((child) => <DynamicWidgetCard key={child.id} entry={child} context={context} />)
        ) : (
          <div className="workspace-dynamic-empty__inline">组内暂无图表，可继续添加独立组件。</div>
        )}
      </DeviceWidgetFrame>
    </DesktopWidget>
  );
}

function DynamicWidgetCard({ entry, context }: { entry: WidgetLayoutCatalogEntry & { id: string }; context: WidgetCatalogContext }) {
  const layout = useWidgetLayout();
  const definition = widgetDefinitionByType.get(entry.widgetType ?? "");
  if (!definition) return null;
  const visualization = visualizationFor(entry, definition);
  const targets = targetOptions(definition, context.metrics, context.localTemperatureSources);
  const targetId = getTargetId(entry) ?? "all";
  return (
    <DesktopWidget
      id={entry.id}
      groupId={entry.groupId}
      title={entry.title}
      kind={entry.kind}
      defaultSize={entry.defaultSize}
      widgetType={definition.widgetType}
      category={definition.category}
      visualization={visualization}
      config={entry.config}
    >
      <div className="workspace-dynamic-card">
        <div className="workspace-dynamic-card__header">
          <div><span className="workspace-section-kicker">{definition.category}</span><h3>{entry.title}</h3><p>{definition.description}</p></div>
          <div className="workspace-dynamic-card__controls">
            {layout.editMode && <select className="workspace-select workspace-select--small" value={visualization} onChange={(event) => layout.updateWidgetConfig(entry.id, { visualization: event.target.value as WidgetVisualization })} aria-label={`${entry.title}图表形式`}>
              {definition.visualizations.map((item) => <option key={item} value={item}>{visualizationLabels[item]}</option>)}
            </select>}
            {layout.editMode && !entry.groupId && targets.length > 0 && <select className="workspace-select workspace-select--small" value={targetId} onChange={(event) => layout.updateWidgetConfig(entry.id, { targetId: event.target.value === "all" ? null : event.target.value })} aria-label={`${entry.title}实例`}>
              <option value="all">全部实例</option>
              {targets.map((target) => <option value={target.id} key={target.id}>{target.name}</option>)}
            </select>}
          </div>
        </div>
        <WidgetContent key={`${entry.id}-${visualization}-${targetId}`} definition={definition} entry={entry} context={context} />
      </div>
    </DesktopWidget>
  );
}

export function DynamicWidgetCanvas({ device, metrics, localTemperatureSources = [], localTemperatureSourcesAt, showEmptyState = false, onOpenDrawer }: WidgetCatalogContext & { showEmptyState?: boolean; onOpenDrawer?: () => void }) {
  const layout = useWidgetLayout();
  const entries = layout.widgetEntries.filter((entry) => Boolean(entry.widgetType) && !isSystemRenderedEntry(entry));

  useEffect(() => {
    if ((!metrics && !localTemperatureSources.length) || !layout.editable || layout.locked) return;
    entries.forEach((entry) => {
      const definition = widgetDefinitionByType.get(entry.widgetType ?? "");
      if (!definition?.targetKind || definition.deviceGroup || entry.groupId || getTargetId(entry)) return;
      const targets = targetOptions(definition, metrics, localTemperatureSources);
      if (!targets.length) return;
      layout.updateWidgetConfig(entry.id, { targetId: targets[0].id });
      targets.slice(1).forEach((target) => {
        layout.addWidget({
          title: `${definition.title} · ${target.name}`,
          kind: definition.kind,
          defaultSize: definition.defaultSize,
          widgetType: definition.widgetType,
          category: definition.category,
          visualization: visualizationFor(entry, definition),
          config: { visualization: visualizationFor(entry, definition), targetId: target.id }
        });
      });
    });
  }, [entries, layout.addWidget, layout.editable, layout.locked, layout.updateWidgetConfig, localTemperatureSources, localTemperatureSourcesAt, metrics]);

  if (!entries.length) {
    return showEmptyState ? <div className="workspace-dynamic-empty"><strong>这个面板还没有自定义小组件</strong><span>{onOpenDrawer ? "打开小组件抽屉，从处理器、存储、网络和 SMART 数据中选择内容。" : "当前为离线缓存，只能查看，暂不能添加小组件。"}</span>{onOpenDrawer && <button type="button" onClick={onOpenDrawer}>打开小组件抽屉</button>}</div> : null;
  }
  const definitions = new Map(entries.map((entry) => [entry.id, widgetDefinitionByType.get(entry.widgetType ?? "")]));
  const groupEntries = entries.filter((entry) => isDeviceGroupDefinition(definitions.get(entry.id)));
  const groupIds = new Set(groupEntries.map((entry) => entry.id));
  const childrenByGroup = new Map<string, Array<WidgetLayoutCatalogEntry & { id: string }>>();
  entries.filter((entry): entry is WidgetLayoutCatalogEntry & { id: string } => Boolean(entry.groupId && groupIds.has(entry.groupId))).forEach((entry) => {
    const children = childrenByGroup.get(entry.groupId!) ?? [];
    children.push(entry);
    childrenByGroup.set(entry.groupId!, children);
  });
  const standaloneEntries = entries.filter((entry) => !groupIds.has(entry.id) && !entry.groupId);
  return (
    <div className="workspace-widget-grid">
      {groupEntries.map((entry) => <DynamicWidgetGroupCard key={entry.id} entry={entry} children={childrenByGroup.get(entry.id) ?? []} context={{ device, metrics, localTemperatureSources, localTemperatureSourcesAt }} />)}
      {standaloneEntries.map((entry) => <DynamicWidgetCard key={entry.id} entry={entry} context={{ device, metrics, localTemperatureSources, localTemperatureSourcesAt }} />)}
    </div>
  );
}

export function WidgetDrawer({ open, onClose, device, metrics, localTemperatureSources = [] }: WidgetCatalogContext & { open: boolean; onClose: () => void }) {
  const layout = useWidgetLayout();
  const [targetDefinition, setTargetDefinition] = useState<WidgetCatalogDefinition | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const drawerGestureRef = useRef<{ pointerId: number; startY: number; offsetY: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDragOffset(0);
    const focusFrame = window.requestAnimationFrame(() => {
      const firstControl = drawerRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)");
      firstControl?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? []);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      drawerGestureRef.current = null;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setTargetDefinition(null);
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  const grouped = WIDGET_CATALOG.reduce<Record<string, WidgetCatalogDefinition[]>>((groups, definition) => {
    (groups[definition.category] ??= []).push(definition);
    return groups;
  }, {});
  const closeDrawer = () => {
    setTargetDefinition(null);
    setDragOffset(0);
    onClose();
  };
  const handleDrawerHandlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawerGestureRef.current = { pointerId: event.pointerId, startY: event.clientY, offsetY: 0 };
  };
  const handleDrawerHandlePointerMove = (event: React.PointerEvent<HTMLSpanElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const offsetY = Math.max(0, event.clientY - gesture.startY);
    gesture.offsetY = offsetY;
    event.preventDefault();
    setDragOffset(offsetY);
  };
  const finishDrawerHandlePointer = (event: React.PointerEvent<HTMLSpanElement>) => {
    const gesture = drawerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drawerGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (gesture.offsetY > 96) closeDrawer();
    else setDragOffset(0);
  };
  const addWidget = (definition: WidgetCatalogDefinition, target?: { id: string; name: string }, customVis?: WidgetVisualization) => {
    const selectedVis = customVis ?? definition.visualization;
    const config: WidgetInstanceConfig = { visualization: selectedVis };
    if (target) config.targetId = target.id;
    layout.setEditMode(true);
    const id = definition.deviceGroup && target && definition.targetKind
      ? layout.addWidgetGroup(
          {
            title: `${definition.title} · ${target.name}`,
            kind: definition.kind,
            defaultSize: definition.defaultSize,
            widgetType: definition.widgetType,
            category: definition.category,
            visualization: selectedVis,
            config
          },
          groupChildrenForTarget(definition.targetKind, target)
        )
      : layout.addWidget({
          title: target ? `${definition.title} · ${target.name}` : definition.title,
          kind: definition.kind,
          defaultSize: definition.defaultSize,
          widgetType: definition.widgetType,
          category: definition.category,
          visualization: selectedVis,
          config
        });
    if (id) setTargetDefinition(null);
  };
  const chooseDefinition = (definition: WidgetCatalogDefinition, customVis?: WidgetVisualization) => {
    if (definition.targetKind) {
      setTargetDefinition(definition);
      return;
    }
    addWidget(definition, undefined, customVis);
  };
  const targetChoices = targetDefinition ? targetOptions(targetDefinition, metrics, localTemperatureSources) : [];
  const targetLabels: Record<WidgetTargetKind, string> = { cpu: "处理器", disk: "硬盘", gpu: "显卡", fan: "风扇", network: "网卡", temperature: "温度源" };
  const targetSelectionLabel = targetDefinition?.targetKind === "temperature" ? "温度源" : targetDefinition ? `${targetLabels[targetDefinition.targetKind ?? "cpu"]}实例` : "";
  return (
    <div className="workspace-widget-drawer-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
      <aside ref={drawerRef} className="workspace-widget-drawer" role="dialog" aria-modal="true" aria-label="小组件抽屉" tabIndex={-1} style={{ "--workspace-drawer-drag-offset": `${dragOffset}px` } as React.CSSProperties}>
        <div className="workspace-widget-drawer__header">
          <span className="workspace-widget-drawer__handle" aria-hidden="true" onPointerDown={handleDrawerHandlePointerDown} onPointerMove={handleDrawerHandlePointerMove} onPointerUp={finishDrawerHandlePointer} onPointerCancel={finishDrawerHandlePointer} onLostPointerCapture={finishDrawerHandlePointer} />
          <div>
            <span className="workspace-section-kicker">{targetDefinition ? "选择目标设备" : "组件目录"}</span>
            <h2>{targetDefinition ? `选择${targetSelectionLabel}` : "添加小组件"}</h2>
            <p>{targetDefinition ? `“${targetDefinition.title}”会绑定到一个具体实例。` : "可以在面板中自由添加和排布小组件。"}</p>
          </div>
          <button type="button" onClick={closeDrawer} aria-label="关闭小组件抽屉">×</button>
        </div>
        <div className="workspace-widget-drawer__body">
          {targetDefinition ? (
            <section className="workspace-widget-drawer__target-list">
              {targetChoices.length ? targetChoices.map((target) => (
                <div className="workspace-widget-drawer__target" key={target.id}>
                  <span><strong>{target.name}</strong>{target.detail && <small>{target.detail}</small>}</span>
                  <div className="workspace-widget-drawer__target-actions">
                    <button type="button" onClick={() => addWidget(targetDefinition, target)}>添加</button>
                  </div>
                </div>
              )) : <div className="workspace-widget-drawer__empty">当前时间范围没有可用的{targetSelectionLabel}。</div>}
            </section>
          ) : Object.entries(grouped).map(([category, definitions]) => <section className="workspace-widget-drawer__group" key={category}><h3>{category}</h3>{definitions.map((definition) => {
            const targets = targetOptions(definition, metrics, localTemperatureSources);
            const available = metricAvailable(definition, metrics, localTemperatureSources) && (!definition.targetKind || targets.length > 0);
            const count = layout.widgetEntries.filter((entry) => entry.widgetType === definition.widgetType && !isSystemRenderedEntry(entry)).length;
            const availability = definition.targetKind ? (targets.length ? "添加时选择具体实例" : "当前没有可用实例") : definition.requires?.length ? "需要对应采集指标" : "可直接使用";
            return (
              <div className={`workspace-widget-drawer__item${available ? "" : " is-unavailable"}`} key={definition.widgetType}>
                <div>
                  <strong>{definition.title}</strong>
                  <p>{definition.description}</p>
                  <small>{count ? `已添加 ${count} 个 · ${availability}` : availability}</small>
                </div>
                <div className="workspace-widget-drawer__actions">
                  <button type="button" disabled={!available} onClick={() => chooseDefinition(definition)}>{definition.targetKind === "temperature" ? "添加" : definition.targetKind ? "选择" : "添加"}</button>
                </div>
              </div>
            );
          })}</section>)}
        </div>
        <div className="workspace-widget-drawer__footer"><span>{targetDefinition ? "选择后会绑定到当前设备" : `${device.hostname} · 当前面板`}</span>{targetDefinition ? <button type="button" onClick={() => setTargetDefinition(null)}>返回目录</button> : <button type="button" onClick={closeDrawer}>完成</button>}</div>
      </aside>
    </div>
  );
}
