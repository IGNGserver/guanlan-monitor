/**
 * 设备详情页固定布局的图表渲染表。
 *
 * 这里是「布局常量」和「真实数据」之间唯一的桥：`DEVICE_CHART_RENDERERS` 用
 * `Record<DeviceChartId, …>` 声明，因此常量里每加一张图表，typecheck 都会要求
 * 这里补上对应渲染器；反过来，常量里删掉的图表会让这里多出无用键而报错。
 * 布局与实现不会再悄悄脱节。
 *
 * 渲染器返回的是「磁贴数组」而不是单个节点：`perInstance` 图表要按硬件实例展开
 * 成 N 张同规格磁贴，没有实例时再退回设备汇总。页面只负责把每张磁贴塞进
 * `DashboardCell`，栅格跨度始终由布局常量决定。
 */
import React from "react";
import {
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper
} from "@carbon/react";
import type {
  CpuMetricSeries,
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceSummary,
  DiskMetricSeries,
  FanMetricSeries,
  GpuMetricSeries,
  MetricSeries,
  MetricsLatest,
  NetworkMetricSeries,
  SamplePoint,
  TrafficCalendarMode,
  TrafficCalendarResponse
} from "@dsc/shared";
import {
  CarbonDonutChart,
  CarbonMeterChart,
  CarbonNumberGrid,
  CarbonTimeSeriesChart,
  type CarbonDonutPart,
  type CarbonNumberItem,
  type CarbonSeries
} from "../CarbonCharts";
import { ChartTile, DashboardCell, isChartAvailable } from "../dashboard";
import type { ChartSpanName, DashboardChartSpec, DashboardSectionSpec, DeviceChartId, DeviceSectionId } from "../dashboard";
import {
  UNAVAILABLE_METRIC_LABEL,
  displayInstanceName,
  displayModelName,
  formatBytes,
  formatCapacitySummary,
  formatCount,
  formatDate,
  formatDuration,
  formatGpuMemorySummary,
  gpuMemoryLabel,
  limitSamplePoints
} from "../formatters";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, CopyButton, Icon, StatusLabel } from "../ui";
import { TemperatureSourcesPanel, TelemetryModelList, TrafficCalendar, TrafficCalendarControls, unavailablePoints } from "./shared";

/** 一张磁贴的描述。字段与 `ChartTile` 的插槽一一对应。 */
export interface DeviceChartTile {
  /** React key；同一分区内必须唯一。 */
  key: string;
  /** 覆盖布局常量里的跨度；实例展开后需要收窄时使用。 */
  span?: ChartSpanName;
  /** 覆盖常量里的标题；实例磁贴会带上实例名。 */
  title?: string;
  subtitle?: string;
  /** 时间序列数据，`line` / `area` 与「详细信息」表都读它。 */
  series?: CarbonSeries[];
  donut?: { parts: CarbonDonutPart[]; centerLabel?: string };
  meter?: { value: number; total: number; label?: string };
  numbers?: CarbonNumberItem[];
  rows?: Array<{ label: string; value: string }>;
  /** `custom` 可视化时渲染的页面自带组件。 */
  node?: React.ReactNode;
  valueFormatter?: (value: number) => string;
  /** 钉住纵轴上界；百分比图表统一用 `PERCENT_TILE` 带上。 */
  maxValue?: number;
  controls?: React.ReactNode;
  footer?: React.ReactNode;
  /** 有值时只渲染提示，不渲染图表体。 */
  emptyMessage?: string;
}

export interface DeviceChartContext {
  device: DeviceSummary;
  /** 按「启用实例」过滤后的 latest；容量汇总一律用它，避免把已关闭的硬盘算进来。 */
  filteredLatest: MetricsLatest | undefined;
  series: MetricSeries | undefined;
  unavailable: (key: DeviceMetricKey) => boolean;
  hasInstanceConfiguration: (block: DeviceBlockKey) => boolean;
  cpuInstances: CpuMetricSeries[];
  diskInstances: DiskMetricSeries[];
  networkInstances: NetworkMetricSeries[];
  gpuInstances: GpuMetricSeries[];
  fanInstances: FanMetricSeries[];
  visibleDiskInstances: DiskMetricSeries[];
  visibleNetworkInstances: NetworkMetricSeries[];
  visibleGpuInstances: GpuMetricSeries[];
  aggregates: {
    cpuUsage: SamplePoint[];
    diskUsedBytes: SamplePoint[];
    networkRx: SamplePoint[];
    networkTx: SamplePoint[];
    gpuUsage: SamplePoint[];
    gpuEncode: SamplePoint[];
    gpuDecode: SamplePoint[];
    gpuMemoryUsedBytes: SamplePoint[];
  };
  summaries: {
    memory: string;
    committed: string;
    pagefile: string;
    disk: string;
    gpuMemory: string;
  };
  modelItems: {
    cpu: Array<{ id: string; name: string; detail?: string }>;
    disk: Array<{ id: string; name: string; detail?: string }>;
    network: Array<{ id: string; name: string; detail?: string }>;
    gpu: Array<{ id: string; name: string; detail?: string }>;
  };
  traffic: {
    data: TrafficCalendarResponse | null;
    mode: TrafficCalendarMode;
    onModeChange: (mode: TrafficCalendarMode) => void;
    onShiftAnchor: (direction: -1 | 1) => void;
  };
  settingsSection: SettingsSection;
  openSettings: (section: SettingsSection) => void;
  canConfigureConnection: boolean;
}

const percent = (value: number) => `${Math.round(value)}%`;
const bytesPerSecond = (value: number) => `${formatBytes(value)}/s`;
const celsius = (value: number) => `${Math.round(value)} °C`;
const megahertz = (value: number) => `${Math.round(value)} MHz`;
const revolutions = (value: number) => `${Math.round(value)} RPM`;
const plainCount = (value: number) => `${Math.round(value)}`;

/**
 * 百分比图表共用的片段。
 *
 * 占用率有天然上界，纵轴必须钉在 0–100%；否则 3% 的抖动会被自动缩放拉满整个
 * 绘图区，看起来像满载。
 */
const PERCENT_TILE = { valueFormatter: percent, maxValue: 100 };

const INSTANCE_BLOCK_LABELS: Record<DeviceBlockKey, string> = {
  cpu: "CPU",
  gpu: "显卡",
  memory: "内存",
  disk: "硬盘",
  network: "网卡",
  fan: "风扇"
};

/** 容量环形图的两个分片；总量非法时返回空数组，图表自己渲染空态。 */
function capacityParts(used: number, total: number, usedLabel = "已用", freeLabel = "空闲"): CarbonDonutPart[] {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return [];
  const clamped = Math.min(Math.max(used, 0), total);
  return [
    { label: usedLabel, value: clamped },
    { label: freeLabel, value: total - clamped }
  ];
}

interface InstanceExpansion<T extends { id: string }> {
  instances: T[];
  block: DeviceBlockKey;
  label: (instance: T) => string;
  tile: (instance: T, label: string) => Omit<DeviceChartTile, "key">;
  /** 设备没有拆分出实例时退回的设备汇总磁贴。 */
  fallback?: () => Omit<DeviceChartTile, "key">;
}

/**
 * 把一张 `perInstance` 图表展开成实例磁贴。
 *
 * 三种情形与重构前一致：有实例就逐实例出图；实例被用户全部关闭时给出明确提示
 * 而不是画空图；设备本来就没有拆分实例时退回设备级汇总序列。
 */
function expandInstances<T extends { id: string }>(
  chart: DashboardChartSpec,
  context: DeviceChartContext,
  expansion: InstanceExpansion<T>
): DeviceChartTile[] {
  if (expansion.instances.length) {
    return expansion.instances.map((instance) => {
      const label = expansion.label(instance);
      const tile = expansion.tile(instance, label);
      return { ...tile, key: `${chart.id}:${instance.id}`, title: tile.title ?? `${label} · ${chart.title}` };
    });
  }
  if (context.hasInstanceConfiguration(expansion.block)) {
    return [{ key: `${chart.id}:disabled`, title: chart.title, emptyMessage: `当前已关闭全部${INSTANCE_BLOCK_LABELS[expansion.block]}实例` }];
  }
  if (expansion.fallback) {
    const tile = expansion.fallback();
    return [{ ...tile, key: `${chart.id}:device`, title: tile.title ?? `设备汇总 · ${chart.title}` }];
  }
  return [{ key: `${chart.id}:empty`, title: chart.title, emptyMessage: `尚未采集到${INSTANCE_BLOCK_LABELS[expansion.block]}实例` }];
}

function gpuLatestFor(context: DeviceChartContext, gpuId: string) {
  return context.filteredLatest?.gpus.find((item) => item.id === gpuId);
}

function gpuTemperatureSubtitle(gpu: GpuMetricSeries, hasPoints: boolean): string {
  if (hasPoints) {
    return gpu.temperatureSource === "cpuPackageShared"
      ? "集成显卡未暴露独立温度 · 使用 CPU 封装温度"
      : "GPU 传感器温度";
  }
  return gpu.integrated ? "未采集 CPU 封装温度" : "未检测到 GPU 温度传感器";
}

/** Carbon `StructuredList` 版的键值表，取代原来的 `TelemetryInfoCard`。 */
function ChartInfoRows({ rows, label }: { rows: Array<{ label: string; value: string }>; label: string }) {
  if (!rows.length) return <div className="chart-tile__empty">暂无可展示的信息</div>;
  return (
    <StructuredListWrapper className="chart-info-rows" aria-label={`${label}详情`} isCondensed isFlush>
      <StructuredListBody>
        {rows.map((row) => (
          <StructuredListRow key={row.label}>
            <StructuredListCell head>{row.label}</StructuredListCell>
            <StructuredListCell>{row.value}</StructuredListCell>
          </StructuredListRow>
        ))}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

/** 「详细信息」抽屉：每条序列的当前值、峰值与最低值。 */
function ChartDetails({ series, valueFormatter }: { series: CarbonSeries[]; valueFormatter?: (value: number) => string }) {
  const fallback = valueFormatter ?? plainCount;
  return (
    <StructuredListWrapper className="chart-details" aria-label="指标详情" isCondensed isFlush>
      <StructuredListHead>
        <StructuredListRow>
          <StructuredListCell head>序列</StructuredListCell>
          <StructuredListCell head>当前</StructuredListCell>
          <StructuredListCell head>峰值</StructuredListCell>
          <StructuredListCell head>最低</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {series.map((item) => {
          const format = item.valueFormatter ?? fallback;
          const values = item.points.map((point) => point.value).filter((value) => Number.isFinite(value));
          const current = values.at(-1);
          const peak = values.length ? Math.max(...values) : undefined;
          const minimum = values.length ? Math.min(...values) : undefined;
          return (
            <StructuredListRow key={item.label}>
              <StructuredListCell head>{item.label}</StructuredListCell>
              <StructuredListCell>{current == null ? "—" : format(current)}</StructuredListCell>
              <StructuredListCell>{peak == null ? "—" : `峰值 ${format(peak)}`}</StructuredListCell>
              <StructuredListCell>{minimum == null ? "—" : `最低 ${format(minimum)}`}</StructuredListCell>
            </StructuredListRow>
          );
        })}
      </StructuredListBody>
    </StructuredListWrapper>
  );
}

/** 按常量里声明的 `visualization` 分派到对应的 Carbon 图表组件。 */
function ChartBody({ chart, tile }: { chart: DashboardChartSpec; tile: DeviceChartTile }) {
  const valueFormatter = tile.valueFormatter ?? plainCount;
  switch (chart.visualization) {
    case "donut":
      return (
        <CarbonDonutChart
          parts={tile.donut?.parts ?? []}
          centerLabel={tile.donut?.centerLabel}
          valueFormatter={valueFormatter}
          compact={chart.compact}
          ariaLabel={`${chart.title}占比环形图`}
        />
      );
    case "meter":
      return (
        <CarbonMeterChart
          value={tile.meter?.value ?? 0}
          total={tile.meter?.total ?? 0}
          label={tile.meter?.label ?? "已用"}
          valueFormatter={valueFormatter}
          compact={chart.compact}
          ariaLabel={`${chart.title}占用仪表图`}
        />
      );
    case "number":
      return <CarbonNumberGrid items={tile.numbers ?? []} />;
    case "table":
      return <ChartInfoRows rows={tile.rows ?? []} label={chart.title} />;
    case "custom":
      return <>{tile.node}</>;
    default:
      return (
        <CarbonTimeSeriesChart
          series={tile.series ?? []}
          visualization={chart.visualization === "area" ? "area" : "line"}
          maxValue={tile.maxValue}
          compact={chart.compact}
        />
      );
  }
}

type ChartRenderer = (chart: DashboardChartSpec, context: DeviceChartContext) => DeviceChartTile[];

function hardwareRows(context: DeviceChartContext): Array<{ label: string; value: string }> {
  const latest = context.filteredLatest;
  const packages = latest?.cpuPackages ?? [];
  return [
    { label: "操作系统", value: context.device.os },
    { label: "设备 ID", value: context.device.deviceId },
    { label: "Agent 版本", value: context.device.agentVersion ? `v${context.device.agentVersion}` : "未知" },
    { label: "CPU 型号", value: packages.map((cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex} · ` : ""}${cpu.model || cpu.name}`).join("、") || "未采集" },
    { label: "运行时间", value: context.unavailable("systemOverview") ? UNAVAILABLE_METRIC_LABEL : formatDuration(latest?.system.uptimeSeconds) },
    { label: "CPU 核心 / 线程", value: `${formatCount(packages.reduce((total, cpu) => total + (cpu.coreCount ?? 0), 0))} / ${formatCount(packages.reduce((total, cpu) => total + (cpu.logicalCount ?? 0), 0))}` },
    { label: "L3 缓存", value: formatBytes(packages.reduce((total, cpu) => total + (cpu.l3CacheBytes ?? 0), 0)) },
    { label: "进程 / 系统线程 / 句柄", value: context.unavailable("systemOverview") ? UNAVAILABLE_METRIC_LABEL : `${formatCount(latest?.system.processCount)} / ${formatCount(latest?.system.threadCount)} / ${formatCount(latest?.system.handleCount)}` },
    { label: "内存容量", value: latest ? formatCapacitySummary(latest.memoryUsedBytes, latest.memoryTotalBytes, context.unavailable("memoryUsage")) : "未采集" },
    { label: "磁盘容量", value: latest ? formatCapacitySummary(latest.diskUsedBytes, latest.diskTotalBytes, context.unavailable("diskUsage")) : "未采集" }
  ];
}

function cpuFactItems(context: DeviceChartContext): CarbonNumberItem[] {
  const latest = context.filteredLatest;
  const packages = latest?.cpuPackages ?? [];
  const system = latest?.system;
  const sum = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
  };
  const overviewUnavailable = context.unavailable("systemOverview");
  return [
    { label: "运行时间", value: overviewUnavailable ? UNAVAILABLE_METRIC_LABEL : formatDuration(system?.uptimeSeconds) },
    { label: "物理核心", value: formatCount(sum(packages.map((cpu) => cpu.coreCount))) },
    { label: "逻辑线程", value: formatCount(sum(packages.map((cpu) => cpu.logicalCount))) },
    { label: "L3 缓存", value: formatBytes(sum(packages.map((cpu) => cpu.l3CacheBytes))) },
    { label: "系统线程", value: overviewUnavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.threadCount) },
    { label: "进程数", value: overviewUnavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.processCount) },
    { label: "句柄数", value: overviewUnavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.handleCount) }
  ];
}

function gpuCapacityTotals(context: DeviceChartContext): { used: number; total: number } {
  const gpus = context.filteredLatest?.gpus ?? [];
  return {
    used: gpus.reduce((total, gpu) => total + (Number.isFinite(gpu.memoryUsedBytes) ? gpu.memoryUsedBytes : 0), 0),
    total: gpus.reduce((total, gpu) => total + (Number.isFinite(gpu.memoryTotalBytes) ? gpu.memoryTotalBytes : 0), 0)
  };
}

/**
 * 布局常量里每个图表 id 的渲染器。
 *
 * 键集合必须与 `DEVICE_DASHBOARD` 完全一致：多一个键或少一个键都会让
 * `Record<DeviceChartId, ChartRenderer>` 编译失败。
 */
export const DEVICE_CHART_RENDERERS: Record<DeviceChartId, ChartRenderer> = {
  "overview-cpu-average": (chart, context) => [{
    key: chart.id,
    subtitle: `全部 ${context.cpuInstances.length} 个 CPU 实例的平均值`,
    series: [{ label: "全部 CPU 平均", points: context.aggregates.cpuUsage }],
    ...PERCENT_TILE,
    footer: <TelemetryModelList label="已采集 CPU 型号" items={context.modelItems.cpu} />
  }],

  "overview-memory": (chart, context) => [{
    key: chart.id,
    subtitle: `物理 ${context.summaries.memory} · 已提交 ${context.summaries.committed} · 页面文件 ${context.summaries.pagefile}`,
    series: [
      { label: "已用物理内存", points: unavailablePoints(context.series?.memoryUsedBytes ?? [], context.unavailable("memoryUsage")), valueFormatter: formatBytes },
      { label: "已提交", points: unavailablePoints(context.series?.memoryCommittedBytes ?? [], context.unavailable("memoryCommitted")), valueFormatter: formatBytes }
    ],
    valueFormatter: formatBytes
  }],

  "overview-disk-total": (chart, context) => [{
    key: chart.id,
    subtitle: `全部 ${context.diskInstances.length} 个硬盘实例的总量 · ${context.summaries.disk}`,
    series: [{ label: "全部硬盘总已用", points: context.aggregates.diskUsedBytes, valueFormatter: formatBytes }],
    valueFormatter: formatBytes,
    footer: <TelemetryModelList label="已采集硬盘型号" items={context.modelItems.disk} />
  }],

  "overview-network-average": (chart, context) => {
    const unavailable = context.unavailable("networkRxRate") || context.unavailable("networkTxRate");
    return [{
      key: chart.id,
      subtitle: unavailable ? UNAVAILABLE_METRIC_LABEL : `全部 ${context.networkInstances.length} 个网卡实例的平均值`,
      series: [
        { label: "平均接收 (Rx)", points: context.aggregates.networkRx, valueFormatter: bytesPerSecond },
        { label: "平均发送 (Tx)", points: context.aggregates.networkTx, valueFormatter: bytesPerSecond }
      ],
      valueFormatter: bytesPerSecond,
      footer: <TelemetryModelList label="已采集网卡型号" items={context.modelItems.network} />
    }];
  },

  "overview-gpu-average": (chart, context) => [{
    key: chart.id,
    subtitle: `全部 ${context.gpuInstances.length} 个显卡实例的平均值`,
    series: [
      { label: "平均核心", points: context.aggregates.gpuUsage },
      { label: "平均编码", points: context.aggregates.gpuEncode },
      { label: "平均解码", points: context.aggregates.gpuDecode }
    ],
    ...PERCENT_TILE,
    footer: <TelemetryModelList label="已采集显卡型号" items={context.modelItems.gpu} />
  }],

  "overview-gpu-memory": (chart, context) => [{
    key: chart.id,
    subtitle: `${context.summaries.gpuMemory} · 全部显卡实例合计`,
    series: [{ label: "GPU 总内存已用", points: context.aggregates.gpuMemoryUsedBytes, valueFormatter: formatBytes }],
    valueFormatter: formatBytes,
    footer: <TelemetryModelList label="已采集显卡型号" items={context.modelItems.gpu} />
  }],

  "overview-capacity-memory": (chart, context) => {
    const latest = context.filteredLatest;
    return [{
      key: chart.id,
      subtitle: context.summaries.memory,
      donut: { parts: capacityParts(latest?.memoryUsedBytes ?? 0, latest?.memoryTotalBytes ?? 0), centerLabel: "物理内存" },
      valueFormatter: formatBytes,
      emptyMessage: latest && latest.memoryTotalBytes > 0 ? undefined : "尚未采集到内存容量"
    }];
  },

  "overview-capacity-disk": (chart, context) => {
    const latest = context.filteredLatest;
    return [{
      key: chart.id,
      subtitle: context.summaries.disk,
      donut: { parts: capacityParts(latest?.diskUsedBytes ?? 0, latest?.diskTotalBytes ?? 0), centerLabel: "磁盘" },
      valueFormatter: formatBytes,
      emptyMessage: latest && latest.diskTotalBytes > 0 ? undefined : "尚未采集到磁盘容量"
    }];
  },

  "overview-capacity-gpu": (chart, context) => {
    const { used, total } = gpuCapacityTotals(context);
    return [{
      key: chart.id,
      subtitle: context.summaries.gpuMemory,
      donut: { parts: capacityParts(used, total, "已用显存", "空闲显存"), centerLabel: "显存" },
      valueFormatter: formatBytes,
      emptyMessage: total > 0 ? undefined : "尚未采集到显存容量"
    }];
  },

  "overview-capacity-swap": (chart, context) => {
    const latest = context.filteredLatest;
    return [{
      key: chart.id,
      subtitle: context.summaries.pagefile,
      meter: { value: latest?.swapUsedBytes ?? 0, total: latest?.swapTotalBytes ?? 0, label: "页面文件" },
      valueFormatter: formatBytes,
      emptyMessage: latest && latest.swapTotalBytes > 0 ? undefined : "本机没有可用的页面文件"
    }];
  },

  "device-hardware-system": (chart, context) => [{
    key: chart.id,
    rows: hardwareRows(context),
    controls: <CopyButton text={context.device.deviceId} label="复制设备 ID" />
  }],

  "device-agent-status": (chart, context) => [{
    key: chart.id,
    subtitle: context.device.status === "online" ? "在线" : "离线",
    node: (
      <div className="chart-agent-note">
        <div className="chart-agent-note__status">
          <StatusLabel state={context.device.status === "online" ? "online" : "offline"} />
          <span>Agent {context.device.agentVersion ? `v${context.device.agentVersion}` : "版本未知"}</span>
          <span>通道 {context.device.agentChannel ?? "未知"}</span>
        </div>
        <p>设备状态和遥测均由中枢提供，本页面不直接读取本机采集状态；未上传或中枢离线时，数据会与其他设备一样不完整。</p>
        <Button variant="quiet" onClick={() => context.openSettings(context.settingsSection)}>
          查看连接设置
          <Icon name="arrow" size={15} />
        </Button>
      </div>
    )
  }],

  "compute-cpu-facts": (chart, context) => [{
    key: chart.id,
    subtitle: context.cpuInstances.length ? `${context.filteredLatest?.cpuPackages.length ?? 0} 个 CPU 实例` : "CPU 实例未采集",
    numbers: cpuFactItems(context)
  }],

  "compute-cpu-usage": (chart, context) => expandInstances(chart, context, {
    instances: context.cpuInstances,
    block: "cpu",
    label: (cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`,
    tile: (cpu, label) => ({
      subtitle: `${cpu.coreCount ?? "未知"} 核 · ${cpu.logicalCount ?? "未知"} 线程`,
      series: [{ label: `${label} 使用率`, points: unavailablePoints(cpu.usagePercent, context.unavailable("cpuUsage")) }],
      ...PERCENT_TILE
    }),
    fallback: () => ({
      subtitle: "未拆分出独立 CPU 实例",
      series: [{ label: "CPU 占用", points: unavailablePoints(context.series?.cpuUsagePercent ?? [], context.unavailable("cpuUsage")) }],
      ...PERCENT_TILE
    })
  }),

  "compute-cpu-frequency": (chart, context) => expandInstances(chart, context, {
    instances: context.cpuInstances,
    block: "cpu",
    label: (cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`,
    tile: (cpu, label) => ({
      subtitle: "实时有效频率",
      series: [{ label: `${label} 频率`, points: unavailablePoints(cpu.frequencyMHz, context.unavailable("cpuFrequency")), valueFormatter: megahertz }],
      valueFormatter: megahertz
    }),
    fallback: () => ({
      subtitle: "未拆分出独立 CPU 实例",
      series: [{ label: "CPU 频率", points: unavailablePoints(context.series?.cpuFrequencyMHz ?? [], context.unavailable("cpuFrequency")), valueFormatter: megahertz }],
      valueFormatter: megahertz
    })
  }),

  "compute-cpu-temperature": (chart, context) => expandInstances(chart, context, {
    instances: context.cpuInstances,
    block: "cpu",
    label: (cpu) => `${cpu.socketIndex != null ? `Socket ${cpu.socketIndex}` : cpu.id} · ${displayModelName(cpu.model, cpu.name, "CPU")}`,
    tile: (cpu, label) => {
      const points = cpu.temperatureC.length || context.cpuInstances.length > 1
        ? cpu.temperatureC
        : context.series?.cpuTemperatureC ?? [];
      return {
        subtitle: "CPU Package / Core",
        series: [{ label: `${label} 温度`, points: unavailablePoints(points, context.unavailable("cpuTemperature")), valueFormatter: celsius }],
        valueFormatter: celsius,
        emptyMessage: context.unavailable("cpuTemperature") ? UNAVAILABLE_METRIC_LABEL : points.length ? undefined : "等待 CPU Package/Core 温度传感器"
      };
    },
    fallback: () => ({
      subtitle: "未拆分出独立 CPU 实例",
      series: [{ label: "CPU 温度", points: unavailablePoints(context.series?.cpuTemperatureC ?? [], context.unavailable("cpuTemperature")), valueFormatter: celsius }],
      valueFormatter: celsius
    })
  }),

  "compute-memory": (chart, context) => [{
    key: chart.id,
    subtitle: `物理 ${context.summaries.memory} · 已提交 ${context.summaries.committed} · 页面文件 ${context.summaries.pagefile}`,
    series: [
      { label: "已用物理内存", points: unavailablePoints(context.series?.memoryUsedBytes ?? [], context.unavailable("memoryUsage")), valueFormatter: formatBytes },
      { label: "已提交", points: unavailablePoints(context.series?.memoryCommittedBytes ?? [], context.unavailable("memoryCommitted")), valueFormatter: formatBytes },
      { label: "缓存", points: unavailablePoints(context.series?.memoryCachedBytes ?? [], context.unavailable("memoryCached")), valueFormatter: formatBytes },
      { label: "页面文件实际使用", points: unavailablePoints(context.series?.swapUsedBytes ?? [], context.unavailable("swapUsage")), valueFormatter: formatBytes }
    ],
    valueFormatter: formatBytes
  }],

  "compute-memory-capacity": (chart, context) => {
    const latest = context.filteredLatest;
    return [{
      key: chart.id,
      subtitle: `已提交 ${context.summaries.committed} · 页面文件 ${context.summaries.pagefile}`,
      donut: { parts: capacityParts(latest?.memoryUsedBytes ?? 0, latest?.memoryTotalBytes ?? 0, "已用", "可用"), centerLabel: "物理内存" },
      valueFormatter: formatBytes,
      emptyMessage: latest && latest.memoryTotalBytes > 0 ? undefined : "尚未采集到内存容量"
    }];
  },

  "compute-system": (chart, context) => [{
    key: chart.id,
    series: [
      { label: "线程数", points: unavailablePoints(context.series?.systemThreadCount ?? [], context.unavailable("systemOverview")) },
      { label: "进程数", points: unavailablePoints(context.series?.systemProcessCount ?? [], context.unavailable("systemOverview")) },
      { label: "句柄数", points: unavailablePoints(context.series?.systemHandleCount ?? [], context.unavailable("systemOverview")) }
    ],
    valueFormatter: plainCount
  }],

  "storage-traffic-calendar": (chart, context) => {
    const data = context.traffic.data;
    return [{
      key: chart.id,
      subtitle: data
        ? `${data.title} · ${formatDate(data.rangeStart)} 至 ${formatDate(data.rangeEnd)}`
        : "尚未收到流量统计",
      controls: (
        <TrafficCalendarControls
          mode={context.traffic.mode}
          onModeChange={context.traffic.onModeChange}
          onShiftAnchor={context.traffic.onShiftAnchor}
        />
      ),
      node: <TrafficCalendar data={data} />
    }];
  },

  "storage-network-throughput": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleNetworkInstances,
    block: "network",
    label: (network) => displayModelName(network.model, network.name, "网卡"),
    tile: (network) => ({
      subtitle: [network.name, network.macAddress, network.ipv4?.[0] || network.ipv6?.[0]].filter(Boolean).join(" · ") || "独立网卡实例",
      series: [
        { label: "接收 (Rx)", points: unavailablePoints(network.rxBytesPerSec, context.unavailable("networkRxRate")), valueFormatter: bytesPerSecond },
        { label: "发送 (Tx)", points: unavailablePoints(network.txBytesPerSec, context.unavailable("networkTxRate")), valueFormatter: bytesPerSecond }
      ],
      valueFormatter: bytesPerSecond
    }),
    fallback: () => ({
      series: [
        { label: "接收 (Rx)", points: unavailablePoints(context.series?.networkRxBytesPerSec ?? [], context.unavailable("networkRxRate")), valueFormatter: bytesPerSecond },
        { label: "发送 (Tx)", points: unavailablePoints(context.series?.networkTxBytesPerSec ?? [], context.unavailable("networkTxRate")), valueFormatter: bytesPerSecond }
      ],
      valueFormatter: bytesPerSecond
    })
  }),

  "storage-disk-capacity": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleDiskInstances,
    block: "disk",
    label: (disk) => displayModelName(disk.model, disk.name, "磁盘"),
    tile: (disk) => {
      const diskLatest = context.filteredLatest?.disks.find((item) => item.id === disk.id);
      return {
        subtitle: [disk.mountPoint, disk.filesystem, formatCapacitySummary(diskLatest?.usedBytes, diskLatest?.totalBytes, context.unavailable("diskUsage"))].filter(Boolean).join(" · "),
        series: [{ label: "已用容量", points: unavailablePoints(disk.usedBytes, context.unavailable("diskUsage")), valueFormatter: formatBytes }],
        valueFormatter: formatBytes
      };
    },
    fallback: () => ({
      subtitle: context.summaries.disk,
      series: [{ label: "已用容量", points: unavailablePoints(context.series?.diskUsedBytes ?? [], context.unavailable("diskUsage")), valueFormatter: formatBytes }],
      valueFormatter: formatBytes
    })
  }),

  "storage-disk-io": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleDiskInstances,
    block: "disk",
    label: (disk) => displayModelName(disk.model, disk.name, "磁盘"),
    tile: (disk) => ({
      subtitle: [disk.mountPoint, disk.filesystem].filter(Boolean).join(" · ") || "当前硬盘 I/O",
      series: [
        { label: "读取", points: unavailablePoints(disk.readBytesPerSec, context.unavailable("diskRead")), valueFormatter: bytesPerSecond },
        { label: "写入", points: unavailablePoints(disk.writeBytesPerSec, context.unavailable("diskWrite")), valueFormatter: bytesPerSecond }
      ],
      valueFormatter: bytesPerSecond
    }),
    fallback: () => ({
      series: [
        { label: "读取", points: unavailablePoints(context.series?.diskReadBytesPerSec ?? [], context.unavailable("diskRead")), valueFormatter: bytesPerSecond },
        { label: "写入", points: unavailablePoints(context.series?.diskWriteBytesPerSec ?? [], context.unavailable("diskWrite")), valueFormatter: bytesPerSecond }
      ],
      valueFormatter: bytesPerSecond
    })
  }),

  "gpu-load": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => ({
      subtitle: "GPU 核心引擎",
      series: [{ label: "核心", points: gpu.usagePercent }],
      ...PERCENT_TILE
    }),
    fallback: () => ({
      subtitle: "GPU 核心引擎",
      series: [{ label: "GPU 核心", points: context.series?.gpuUsagePercent ?? [] }],
      ...PERCENT_TILE
    })
  }),

  "gpu-encode": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => ({
      subtitle: "视频编码引擎",
      span: "quarter",
      series: [{ label: "编码", points: gpu.encodePercent }],
      ...PERCENT_TILE
    }),
    fallback: () => ({
      subtitle: "视频编码引擎",
      series: [{ label: "GPU 编码", points: context.series?.gpuEncodePercent ?? [] }],
      ...PERCENT_TILE
    })
  }),

  "gpu-decode": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => ({
      subtitle: "视频解码引擎",
      span: "quarter",
      series: [{ label: "解码", points: gpu.decodePercent }],
      ...PERCENT_TILE
    }),
    fallback: () => ({
      subtitle: "视频解码引擎",
      series: [{ label: "GPU 解码", points: context.series?.gpuDecodePercent ?? [] }],
      ...PERCENT_TILE
    })
  }),

  "gpu-frequency": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => ({
      subtitle: "GPU 核心时钟",
      series: [{ label: "频率", points: gpu.frequencyMHz, valueFormatter: megahertz }],
      valueFormatter: megahertz
    }),
    fallback: () => ({
      subtitle: "GPU 核心时钟",
      series: [{ label: "GPU 频率", points: context.series?.gpuFrequencyMHz ?? [], valueFormatter: megahertz }],
      valueFormatter: megahertz
    })
  }),

  "gpu-memory": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => {
      const latest = gpuLatestFor(context, gpu.id);
      const memoryLabel = gpuMemoryLabel(latest?.memoryKind ?? gpu.memoryKind);
      return {
        title: `${displayInstanceName(gpu.name, "GPU")} · ${memoryLabel}已用容量`,
        subtitle: latest ? formatGpuMemorySummary([latest]) : "容量暂无",
        series: [{ label: `${memoryLabel}已用`, points: gpu.memoryUsedBytes, valueFormatter: formatBytes }],
        valueFormatter: formatBytes
      };
    },
    fallback: () => ({
      subtitle: context.summaries.gpuMemory,
      series: [{ label: "GPU 内存已用", points: context.series?.gpuMemoryUsedBytes ?? [], valueFormatter: formatBytes }],
      valueFormatter: formatBytes
    })
  }),

  "gpu-temperature": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu) => {
      const points = gpu.temperatureC ?? [];
      return {
        subtitle: gpuTemperatureSubtitle(gpu, points.length > 0),
        series: [{ label: "温度", points, valueFormatter: celsius }],
        valueFormatter: celsius,
        emptyMessage: points.length ? undefined : gpu.integrated ? "未采集 CPU 封装温度" : "未检测到 GPU 温度传感器"
      };
    },
    fallback: () => ({
      subtitle: "GPU 设备汇总",
      series: [{ label: "温度", points: context.series?.gpuTemperatureC ?? [], valueFormatter: celsius }],
      valueFormatter: celsius,
      emptyMessage: "等待 GPU 温度传感器"
    })
  }),

  "gpu-driver": (chart, context) => expandInstances(chart, context, {
    instances: context.visibleGpuInstances,
    block: "gpu",
    label: (gpu) => displayInstanceName(gpu.name, "GPU"),
    tile: (gpu, label) => {
      const latest = gpuLatestFor(context, gpu.id);
      return {
        subtitle: "适配器与驱动版本",
        rows: [
          { label: "适配器", value: label },
          { label: "驱动版本", value: latest?.driverVersion || "未报告" },
          { label: "显存类型", value: gpuMemoryLabel(latest?.memoryKind ?? gpu.memoryKind) }
        ]
      };
    },
    fallback: () => ({
      subtitle: "全部 GPU 适配器",
      rows: (context.filteredLatest?.gpus ?? []).map((item) => ({ label: item.name, value: item.driverVersion || "未报告" }))
    })
  }),

  "gpu-temperature-sources": (chart, context) => [{
    key: chart.id,
    subtitle: `${context.filteredLatest?.temperatureSensors.length ?? 0} 个温度源`,
    node: (
      <TemperatureSourcesPanel
        sensors={context.filteredLatest?.temperatureSensors ?? []}
        series={context.series?.temperatureSensors ?? []}
      />
    )
  }],

  "fan-rpm": (chart, context) => {
    if (!context.fanInstances.length) {
      return [{ key: chart.id, title: chart.title, emptyMessage: "尚未收到风扇样本；请先在 Agent 设置中重新检测硬件并启动采集。" }];
    }
    return context.fanInstances.map((fan) => {
      const fanLatest = context.filteredLatest?.fans.find((item) => item.id === fan.id);
      const currentRpm = fanLatest?.rpm ?? fan.rpm[fan.rpm.length - 1]?.value;
      return {
        key: `${chart.id}:${fan.id}`,
        title: `${fan.name} · ${chart.title}`,
        subtitle: [fan.interface || "风扇接口", currentRpm == null ? "当前值未知" : `当前 ${Math.round(currentRpm)} RPM`].join(" · "),
        series: [{ label: "转速", points: fan.rpm, valueFormatter: revolutions }],
        valueFormatter: revolutions
      } satisfies DeviceChartTile;
    });
  }
};

/**
 * 渲染一个分区里的全部图表磁贴。
 *
 * 页面只管分区外壳与锚点，磁贴的展开、跨度与空态判定都收在这里，
 * 这样 `DeviceDetailsPage` 不需要知道任何具体指标。
 */
export function DeviceChartCells({ section, context }: { section: DashboardSectionSpec; context: DeviceChartContext }) {
  // 图表点数上限由运行时画像决定（远程会话与内存吃紧时会下调），
  // 这里统一裁剪，避免每张图各自实现一遍。
  const { chartPointLimit } = useWorkspace();

  const cells = section.charts.flatMap((chart) => {
    if (!isChartAvailable(chart, context.unavailable)) {
      return [{
        node: (
          <DashboardCell key={chart.id} span={chart.span}>
            <ChartTile title={chart.title} emptyMessage={UNAVAILABLE_METRIC_LABEL} />
          </DashboardCell>
        )
      }];
    }
    const renderer: ChartRenderer | undefined = DEVICE_CHART_RENDERERS[chart.id as DeviceChartId];
    if (!renderer) {
      // 类型上不可能走到这里（渲染表被 Record<DeviceChartId, …> 约束），
      // 但 `as` 断言会绕过检查，所以留一个显式可见的兜底而不是静默丢图。
      return [{
        node: (
          <DashboardCell key={chart.id} span={chart.span}>
            <ChartTile title={chart.title} emptyMessage={`图表 ${chart.id} 还没有渲染器`} />
          </DashboardCell>
        )
      }];
    }
    return renderer(chart, context).map((tile) => ({
      node: (
        <DashboardCell key={tile.key} span={tile.span ?? chart.span}>
          <ChartTile
            title={tile.title ?? chart.title}
            subtitle={tile.subtitle}
            controls={tile.controls}
            emptyMessage={tile.emptyMessage}
            footer={tile.footer}
            details={tile.series?.length
              ? <ChartDetails series={tile.series} valueFormatter={tile.valueFormatter} />
              : undefined}
          >
            <ChartBody chart={chart} tile={limitTileSeries(tile, chartPointLimit)} />
          </ChartTile>
        </DashboardCell>
      )
    }));
  });

  return <>{cells.map((cell) => cell.node)}</>;
}

function limitTileSeries(tile: DeviceChartTile, chartPointLimit: number): DeviceChartTile {
  if (!tile.series?.length) return tile;
  return {
    ...tile,
    series: tile.series.map((item) => ({ ...item, points: limitSamplePoints(item.points, chartPointLimit) }))
  };
}

/** 分区级筛选控件的键集合；用 `DeviceSectionId` 而不是 `string`，写错锚点会编译报错。 */
export type DeviceSectionControls = Partial<Record<DeviceSectionId, React.ReactNode>>;
