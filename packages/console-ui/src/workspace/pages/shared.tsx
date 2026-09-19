import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { DataTable, Modal, OverflowMenu, OverflowMenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag } from "@carbon/react";
import type { AgentProbeProvider, AgentProbeTarget, CpuPackageStats, DeviceBlockKey, DeviceMetricKey, DesktopDetectedTargetGroup, DeviceSummary, FanMetricSeries, FanSensorStats, SamplePoint, SystemStats, TemperatureMetricSeries, TemperatureSensorReading, TrafficCalendarMode, TrafficCalendarResponse, VirtualizationStorageMetricSeries, VirtualizationStorageTelemetry, WidgetInstanceConfig, WidgetLayoutDocument, WidgetLayoutSaveRequest, WidgetPanelMetadata } from "@dsc/shared";
import { isDisplayableVirtualizationStorage, isDisplayableVirtualizationStorageSeries, virtualizationStorageInstances } from "@dsc/shared";
import appIcon from "../../assets/app-icon.png";
import { useWorkspace } from "../WorkspaceContext";
import type { DeviceDirectorySort, DeviceDirectoryStatus } from "../selectors";
import {
  DesktopWidget,
  WidgetLayoutProvider,
  WidgetLayoutToolbar,
  confirmDiscardWidgetLayoutDraft,
  useOptionalWidgetLayout,
  type WidgetKind,
  type WidgetDisplayMode,
  type WidgetSize
} from "../WidgetLayout";
import { DeviceWidgetFrame } from "../DeviceWidgetFrame";
import { DynamicWidgetCanvas, WidgetDrawer } from "../widgetCatalog";
import { M3Checkbox, M3Chip, M3SegmentedControl, M3Select, M3Switch, M3Tabs, M3TextField } from "../m3";
import { Button, Icon, StatusLabel, Surface, SummaryRow, virtualMachinePowerState } from "../ui";
import { TelemetryChartCard, TelemetryInfoCard } from "../TelemetryCards";
import {
  UNAVAILABLE_METRIC_LABEL,
  WINDOW_DURATION_MAP,
  averageSamplePointsOrFallback,
  displayInstanceName,
  displayModelName,
  formatAxisTime,
  formatBytes,
  formatCapacitySummary,
  formatCount,
  formatDate,
  formatDuration,
  formatGpuMemorySummary,
  formatPreciseDateTime,
  gpuMemoryLabel,
  splitPointsIntoSegments,
  sumSamplePoints
} from "../formatters";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

function isMetricUnavailable(
  device: Pick<DeviceSummary, "instanceType" | "unavailableMetrics">,
  key: DeviceMetricKey,
  latest?: { unavailableMetrics?: DeviceMetricKey[] } | null
): boolean {
  if (device.instanceType !== "virtual_machine") return false;
  return new Set([...(device.unavailableMetrics ?? []), ...(latest?.unavailableMetrics ?? [])]).has(key);
}

function unavailablePoints(points: SamplePoint[], unavailable: boolean): SamplePoint[] {
  return unavailable ? [] : points;
}

function formatVirtualizationStorageType(type: string | null | undefined): string {
  const labels: Record<string, string> = {
    btrfs: "Btrfs",
    cephfs: "CephFS",
    cifs: "CIFS",
    dir: "目录",
    glusterfs: "GlusterFS",
    iscsi: "iSCSI",
    lvm: "LVM",
    lvmthin: "LVM-Thin",
    nfs: "NFS",
    rbd: "RBD",
    zfspool: "ZFS 存储池"
  };
  return type ? labels[type.toLowerCase()] ?? type : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStorageValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatBytes(value) : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStoragePercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : UNAVAILABLE_METRIC_LABEL;
}

function formatVirtualizationStorageCapacity(usedBytes: number | null | undefined, totalBytes: number | null | undefined): string {
  const complete = typeof usedBytes === "number" && Number.isFinite(usedBytes)
    && typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0;
  return formatCapacitySummary(usedBytes, totalBytes, !complete);
}

function latestSampleValue(points: SamplePoint[] | undefined): number | null {
  const value = points?.at(-1)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
      { key: "gpuMemory", label: "GPU 内存使用" },
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
      { key: "fanChannelState", label: "通道状态" }
    ]
  },
  {
    label: "温度源",
    items: [
      { key: "temperatureSources", label: "全部温度传感器" }
    ]
  }
];

const instanceMetricOptions: Partial<Record<AgentProbeTarget, Array<{ key: DeviceMetricKey; label: string }>>> = {
  cpu: metricGroups[0].items,
  gpu: metricGroups[1].items,
  disk: metricGroups[3].items,
  network: metricGroups[4].items
};

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
  hwmon: "Linux hwmon",
  wmi: "Windows WMI",
  librehardwaremonitor: "LibreHardwareMonitor",
  libreHardwareMonitor: "LibreHardwareMonitor",
  openHardwareMonitor: "OpenHardwareMonitor",
  redfish: "Redfish",
  disabled: "禁用"
};

function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <div className="workspace-page-intro"><div>{eyebrow && <div className="workspace-page-intro__eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="workspace-page-intro__actions">{actions}</div>}</div>;
}

function DeviceDirectoryFilterBar({
  devices,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  sort,
  onSortChange,
  sortDisabled = false,
  actions
}: {
  devices: DeviceSummary[];
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: "all" | "device" | "virtual_machine";
  onTypeFilterChange: (value: "all" | "device" | "virtual_machine") => void;
  statusFilter: DeviceDirectoryStatus;
  onStatusFilterChange: (value: DeviceDirectoryStatus) => void;
  sort: DeviceDirectorySort;
  onSortChange: (value: DeviceDirectorySort) => void;
  sortDisabled?: boolean;
  actions?: React.ReactNode;
}) {
  const onlineCount = devices.filter((device) => device.status === "online").length;
  return <div className="workspace-directory-toolbar">
    <M3TextField label="搜索设备" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="名称、设备 ID、系统或宿主机" type="search" />
    <M3SegmentedControl options={[{ value: "all", label: "全部类型" }, { value: "device", label: "普通设备" }, { value: "virtual_machine", label: "虚拟机" }]} value={typeFilter} onChange={(value) => onTypeFilterChange(value as "all" | "device" | "virtual_machine")} aria-label="设备类型" />
    <div className="workspace-directory-toolbar__chips" aria-label="设备状态">
      <M3Chip selected={statusFilter === "all"} onClick={() => onStatusFilterChange("all")}>全部 {devices.length}</M3Chip>
      <M3Chip selected={statusFilter === "online"} onClick={() => onStatusFilterChange("online")}>在线 {onlineCount}</M3Chip>
      <M3Chip selected={statusFilter === "offline"} onClick={() => onStatusFilterChange("offline")}>离线 {devices.length - onlineCount}</M3Chip>
    </div>
    <M3Select label="排序" hideLabel value={sort} onChange={(event) => onSortChange(event.target.value as DeviceDirectorySort)} disabled={sortDisabled} options={[{ value: "order", label: "中枢顺序" }, { value: "name", label: "名称" }, { value: "cpu", label: "CPU" }, { value: "memory", label: "内存" }, { value: "lastSeen", label: "最近响应" }]} />
    {actions && <div className="workspace-directory-toolbar__actions">{actions}</div>}
  </div>;
}
function ConfirmDialog({
  title,
  detail,
  confirmLabel = "确认",
  onConfirm,
  onCancel,
  disabled = false
}: {
  title: string;
  detail: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return <Modal
    open
    danger
    modalLabel="请确认操作"
    modalHeading={title}
    primaryButtonText={disabled ? "处理中…" : confirmLabel}
    secondaryButtonText="取消"
    primaryButtonDisabled={disabled}
    onRequestClose={(event) => { event.preventDefault(); if (!disabled) onCancel(); }}
    onSecondarySubmit={(event) => { event.preventDefault(); if (!disabled) onCancel(); }}
    onRequestSubmit={(event) => { event.preventDefault(); if (!disabled) onConfirm(); }}
  >
    <p>{detail}</p>
  </Modal>;
}

function PromptDialog({
  title,
  detail,
  initialValue,
  confirmLabel = "保存",
  onConfirm,
  onCancel,
  disabled = false
}: {
  title: string;
  detail: string;
  initialValue: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);
  const submit = () => {
    const nextValue = value.trim();
    if (!nextValue || disabled) return;
    onConfirm(nextValue);
  };
  return <Modal
    open
    modalLabel="编辑名称"
    modalHeading={title}
    primaryButtonText={disabled ? "处理中…" : confirmLabel}
    secondaryButtonText="取消"
    primaryButtonDisabled={disabled || !value.trim()}
    onRequestClose={(event) => { event.preventDefault(); if (!disabled) onCancel(); }}
    onSecondarySubmit={(event) => { event.preventDefault(); if (!disabled) onCancel(); }}
    onRequestSubmit={(event) => { event.preventDefault(); submit(); }}
  >
    <p>{detail}</p>
    <M3TextField label="名称" autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} maxLength={80} />
  </Modal>;
}

function directoryCapacityText(device: DeviceSummary, kind: "memory" | "disk", unavailable: boolean): string {
  if (unavailable) return UNAVAILABLE_METRIC_LABEL;
  const used = kind === "memory" ? device.memoryUsedBytes : device.diskUsedBytes;
  const total = kind === "memory" ? device.memoryTotalBytes : device.diskTotalBytes;
  const percent = kind === "memory" ? device.memoryUsagePercent : device.diskUsagePercent;
  if (Number.isFinite(used) && Number.isFinite(total) && (total ?? 0) > 0) return `${formatBytes(used)} / ${formatBytes(total)}${percent == null ? "" : ` · ${percent}%`}`;
  return percent == null ? "—" : `${percent}%`;
}

function directoryStatusTag(device: DeviceSummary) {
  if (device.instanceType === "virtual_machine") {
    const power = virtualMachinePowerState(device.virtualMachine?.powerState);
    return <Tag type={power.state === "online" ? "green" : power.state === "warning" ? "warm-gray" : "red"}>{power.label}</Tag>;
  }
  return <Tag type={device.status === "online" ? "green" : "gray"}>{device.status === "online" ? "在线" : "离线"}</Tag>;
}

function CarbonDeviceTable({
  devices,
  order,
  manageMode = false,
  onMove,
  onDelete,
  emptyState
}: {
  devices: DeviceSummary[];
  order?: string[];
  manageMode?: boolean;
  onMove?: (deviceId: string, direction: -1 | 1) => void;
  onDelete?: (device: DeviceSummary) => void;
  emptyState?: React.ReactNode;
}) {
  const { navigate } = useWorkspace();
  const headers = [
    { key: "status", header: "状态" },
    { key: "device", header: "设备实例" },
    { key: "cpu", header: "CPU" },
    { key: "memory", header: "内存" },
    { key: "disk", header: "磁盘" },
    { key: "heartbeat", header: "最近心跳" },
    { key: "actions", header: "操作" }
  ];
  const rows = devices.map((device) => ({
    id: device.deviceId,
    status: device.status,
    device: device.hostname,
    cpu: isMetricUnavailable(device, "cpuUsage") || device.cpuUsagePercent == null ? "—" : `${device.cpuUsagePercent}%`,
    memory: directoryCapacityText(device, "memory", isMetricUnavailable(device, "memoryUsage")),
    disk: directoryCapacityText(device, "disk", isMetricUnavailable(device, "diskUsage")),
    heartbeat: formatDate(device.lastSeenAt),
    actions: ""
  }));

  if (!rows.length) return <>{emptyState ?? <EmptyState title="没有匹配设备" detail="尝试清空搜索或调整筛选条件。" />}</>;

  return (
    <DataTable rows={rows} headers={headers} isSortable={false}>
      {({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => (
        <TableContainer>
          <Table {...getTableProps()} size="md" useZebraStyles={false}>
            <TableHead><TableRow>{tableHeaders.map((header) => <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>)}</TableRow></TableHead>
            <TableBody>
              {tableRows.map((row) => {
                const device = devices.find((item) => item.deviceId === row.id);
                if (!device) return null;
                const deviceIndex = order?.indexOf(device.deviceId) ?? -1;
                return (
                  <TableRow {...getRowProps({ row })}>
                    {row.cells.map((cell) => {
                      if (cell.info.header === "status") return <TableCell key={cell.id}>{directoryStatusTag(device)}</TableCell>;
                      if (cell.info.header === "device") return <TableCell key={cell.id}><button className="guanlan-table-link" type="button" onClick={() => navigate({ kind: "device", deviceId: device.deviceId })}>{device.hostname}</button><small className="guanlan-table-secondary">{device.instanceType === "virtual_machine" ? `虚拟机 · ${device.hostName ?? "宿主机未知"}` : `${device.os} · ID ${device.deviceId}`}</small></TableCell>;
                      if (cell.info.header === "heartbeat") return <TableCell key={cell.id}><span className={device.status === "online" ? "" : "guanlan-table-stale"}>{cell.value}</span><small className="guanlan-table-secondary">{device.status === "online" ? "当前响应" : "心跳已过期"}</small></TableCell>;
                      if (cell.info.header === "actions") return <TableCell key={cell.id}>{manageMode && (onMove || onDelete) ? <OverflowMenu aria-label={`管理 ${device.hostname}`} size="sm" direction="bottom"><OverflowMenuItem itemText="上移" disabled={deviceIndex <= 0} onClick={() => onMove?.(device.deviceId, -1)} /><OverflowMenuItem itemText="下移" disabled={deviceIndex < 0 || deviceIndex >= (order?.length ?? 1) - 1} onClick={() => onMove?.(device.deviceId, 1)} /><OverflowMenuItem itemText="删除" isDelete onClick={() => onDelete?.(device)} /></OverflowMenu> : null}</TableCell>;
                      return <TableCell key={cell.id}>{cell.value}</TableCell>;
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </DataTable>
  );
}

function OverviewSummary({
  total,
  online,
  offline,
  issueCount,
  instanceLabel,
  sourceLabel,
  sourceState,
  sourceDetail
}: {
  total: number;
  online: number;
  offline: number;
  issueCount: number | null;
  instanceLabel: string;
  sourceLabel: string;
  sourceState: "online" | "offline" | "cached" | "warning" | "unknown";
  sourceDetail: string;
}) {
  return (
    <div className="workspace-overview-summary" aria-label="状态摘要">
      <div className="workspace-overview-summary__item">
        <span>当前实例</span>
        <strong>{total}</strong>
        <small>{instanceLabel} · 全局健康统计</small>
      </div>
      <div className="workspace-overview-summary__item">
        <span>在线状态</span>
        <strong>{online}<small> / {total}</small></strong>
        <small>{offline ? `${offline} 台离线或未响应；VM 按电源状态展示` : "全部实例正在响应；VM 另显示电源状态"}</small>
      </div>
      <div className={`workspace-overview-summary__item${issueCount ? " is-warning" : ""}`}>
        <span>待处理事项</span>
        <strong>{issueCount == null ? "无法判断" : issueCount}</strong>
        <small>{issueCount == null ? "连接状态异常，暂无法判断" : issueCount ? "需要进一步检查" : "当前没有待处理事项"}</small>
      </div>
      <div className="workspace-overview-summary__item workspace-overview-summary__item--source">
        <div className="workspace-overview-summary__label"><span>数据来源</span><StatusLabel state={sourceState} compact /></div>
        <strong>{sourceLabel}</strong>
        <small>{sourceDetail}</small>
      </div>
    </div>
  );
}


function TelemetrySection({
  id,
  eyebrow,
  title,
  description,
  controls,
  children
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="workspace-telemetry-section">
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

function mergeFanMetricSeries(latestFans: FanSensorStats[], historicalFans: FanMetricSeries[], fallbackTimestamp: string): FanMetricSeries[] {
  const latestById = new Map(latestFans.map((fan) => [fan.id, fan]));
  const merged = historicalFans.map((fan) => {
    const latest = latestById.get(fan.id);
    const currentPoint = latest ? { timestamp: fallbackTimestamp, value: latest.rpm } : null;
    const hasCurrentPoint = currentPoint ? fan.rpm.some((point) => point.timestamp === currentPoint.timestamp) : true;
    const rpm = currentPoint && !hasCurrentPoint
      ? [...fan.rpm, currentPoint].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      : fan.rpm;
    return {
      ...fan,
      name: latest?.label || fan.name,
      interface: latest?.interface || fan.interface,
      rpm
    };
  });
  const seen = new Set(merged.map((fan) => fan.id));
  for (const fan of latestFans) {
    if (seen.has(fan.id)) continue;
    merged.push({
      id: fan.id,
      name: fan.label,
      interface: fan.interface,
      rpm: [{ timestamp: fallbackTimestamp, value: fan.rpm }]
    });
  }
  return merged;
}

const TELEMETRY_DEVICE_GROUP_TYPES: Record<"cpu" | "disk" | "gpu" | "network" | "fan", string> = {
  cpu: "cpu-device-group",
  disk: "disk-device-group",
  gpu: "gpu-device-group",
  network: "network-device-group",
  fan: "fan-device-group"
};

const TELEMETRY_DEVICE_GROUP_CATEGORIES: Record<"cpu" | "disk" | "gpu" | "network" | "fan", string> = {
  cpu: "处理器",
  disk: "存储",
  gpu: "显卡",
  network: "网络",
  fan: "散热"
};

function TelemetryDeviceBlock({
  widgetId,
  widgetTemplateId,
  targetId,
  widgetDefaultSize = "large",
  kind = "cpu",
  eyebrow = "设备实例",
  title = "设备详情",
  subtitle,
  children
}: {
  widgetId?: string;
  widgetTemplateId?: string;
  targetId?: string;
  widgetDefaultSize?: WidgetSize;
  kind?: "cpu" | "disk" | "gpu" | "network" | "fan";
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const widgetType = widgetId ? TELEMETRY_DEVICE_GROUP_TYPES[kind] : undefined;
  const widgetConfig: WidgetInstanceConfig | undefined = widgetId
    ? { systemRendered: true, ...(targetId ? { targetId } : {}) }
    : undefined;
  const childCount = React.Children.count(children);
  const defaultH = childCount >= 3 ? 4 : 2;
  const compactH = Math.max(2, childCount * 2);
  const frame = (
    <DeviceWidgetFrame kind={kind} eyebrow={eyebrow} title={title} subtitle={subtitle} count={`${childCount} 个图表`} contentClassName="workspace-device-block__charts--dynamic">
      {children}
    </DeviceWidgetFrame>
  );
  if (!widgetId) return frame;
  return (
    <DesktopWidget
      id={widgetId}
      templateId={widgetTemplateId}
      title={title}
      widgetType={widgetType}
      category={widgetType ? TELEMETRY_DEVICE_GROUP_CATEGORIES[kind] : undefined}
      visualization="table"
      config={widgetConfig}
      kind="group"
      defaultSize={widgetDefaultSize}
      defaultH={defaultH}
      compactH={compactH}
      className="workspace-widget--device-frame"
    >
      {frame}
    </DesktopWidget>
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

function CpuFactsCard({ cpus, system, unavailable = false }: { cpus: CpuPackageStats[]; system?: SystemStats; unavailable?: boolean }) {
  const sum = (values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => Number.isFinite(value));
    return valid.length ? valid.reduce((total, value) => total + value, 0) : null;
  };
  const facts = [
    { label: "运行时间", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatDuration(system?.uptimeSeconds), className: "workspace-cpu-fact--duration" },
    { label: "物理核心", value: formatCount(sum(cpus.map((cpu) => cpu.coreCount))) },
    { label: "逻辑线程", value: formatCount(sum(cpus.map((cpu) => cpu.logicalCount))) },
    { label: "L3 缓存", value: formatBytes(sum(cpus.map((cpu) => cpu.l3CacheBytes))) },
    { label: "系统线程", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.threadCount) },
    { label: "进程数", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.processCount) },
    { label: "句柄数", value: unavailable ? UNAVAILABLE_METRIC_LABEL : formatCount(system?.handleCount) }
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
    <M3Select
      className="workspace-instance-filter"
      selectClassName="workspace-select workspace-select--small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "all", label: "全部实例" },
        ...options.map((option) => ({ value: option.id, label: `${option.name}${option.detail ? ` · ${option.detail}` : ""}` }))
      ]}
    />
  );
}

function InstanceMetricOverride({
  target,
  instanceId,
  globalMetrics,
  override,
  onChange,
  disabled
}: {
  target: AgentProbeTarget;
  instanceId: string;
  globalMetrics: DeviceMetricKey[];
  override?: DeviceMetricKey[];
  onChange: (value: DeviceMetricKey[] | undefined) => void;
  disabled: boolean;
}) {
  const options = instanceMetricOptions[target];
  if (!options?.length) return null;
  const isOverridden = Array.isArray(override);
  const enabledSet = new Set(override ?? globalMetrics);
  return (
    <details className="workspace-detected-metrics" open={isOverridden}>
      <summary>{isOverridden ? "已单独配置指标" : "跟随全局指标"}</summary>
      <div className="workspace-detected-metrics__body">
        <div className="workspace-detected-metrics__options">
          {options.map((option) => {
            const globallyEnabled = globalMetrics.includes(option.key);
            return <M3Checkbox
              key={option.key}
              compact
              className={!globallyEnabled ? "is-unavailable" : undefined}
              label={option.label}
              checked={globallyEnabled && enabledSet.has(option.key)}
              disabled={disabled || !globallyEnabled}
              title={!globallyEnabled ? "请先在上方启用全局指标" : undefined}
              onCheckedChange={(checked) => {
                const next = new Set(enabledSet);
                if (checked) next.add(option.key);
                else next.delete(option.key);
                onChange([...next]);
              }}
            />;
          })}
        </div>
        {isOverridden && <button type="button" className="workspace-detected-metrics__inherit" onClick={() => onChange(undefined)} disabled={disabled}>恢复跟随全局</button>}
      </div>
    </details>
  );
}

function TrafficCalendarCard({
  data,
  mode,
  onModeChange
}: {
  data: TrafficCalendarResponse | null;
  mode: TrafficCalendarMode;
  onModeChange: (mode: TrafficCalendarMode) => void;
}) {
  const modes: Array<{ value: TrafficCalendarMode; label: string }> = [
    { value: "day", label: "日" },
    { value: "week", label: "周" },
    { value: "month", label: "月" }
  ];
  const maxTraffic = Math.max(...(data?.cells ?? []).map((cell) => cell.totalRxBytes + cell.totalTxBytes), 1);
  return (
    <Surface className="workspace-traffic-calendar">
      <div className="workspace-surface__header">
        <div><span className="workspace-section-kicker">流量日历</span><h3>网络流量消耗</h3></div>
        <M3SegmentedControl
          className="workspace-range-control__options"
          options={modes}
          value={mode}
          onChange={(value) => onModeChange(value as TrafficCalendarMode)}
          aria-label="流量日历范围"
        />
      </div>
      {data ? <>
        <p className="workspace-surface__description">{data.title} · {formatDate(data.rangeStart)} 至 {formatDate(data.rangeEnd)}</p>
        <div className="workspace-traffic-calendar__cells">
          {data.cells.map((cell) => {
            const total = cell.totalRxBytes + cell.totalTxBytes;
            return <div className={`workspace-traffic-calendar__cell${cell.isSelected ? " is-selected" : ""}`} key={cell.key} style={{ opacity: 0.45 + (total / maxTraffic) * 0.55 }}><strong>{cell.label}</strong><small>{formatBytes(total)}</small></div>;
          })}
        </div>
        <div className="workspace-detail-list"><SummaryRow label="接收" value={formatBytes(data.totalRxBytes)} /><SummaryRow label="发送" value={formatBytes(data.totalTxBytes)} /><SummaryRow label="采样记录" value={`${data.records.length} 条`} /></div>
      </> : <div className="workspace-muted-block">暂无流量日历数据；请确认设备已上报网络流量统计。</div>}
    </Surface>
  );
}

export type DesktopMetricWindowValue = "5m" | "1h" | "6h" | "24h" | "7d";

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
      <M3SegmentedControl
        className="workspace-range-control__options"
        options={metricWindowOptions}
        value={value}
        onChange={(nextValue) => onChange(nextValue as DesktopMetricWindowValue)}
        aria-label="遥测时间范围"
      />
    </div>
  );
}

type DeviceTabKey = "overview" | "compute" | "storage_net" | "gpu_thermal" | "fan" | "all";

const DEFAULT_DEVICE_PANELS: WidgetPanelMetadata[] = [
  { id: "overview", name: "综合面板", kind: "system", order: 0 },
  { id: "compute", name: "算力与内存", kind: "system", order: 1 },
  { id: "storage_net", name: "存储与网络", kind: "system", order: 2 },
  { id: "gpu_thermal", name: "显卡与散热", kind: "system", order: 3 },
  { id: "fan", name: "风扇转速", kind: "system", order: 4 },
  { id: "all", name: "全景视图", kind: "system", order: 5 }
];

function cloneDevicePanels(panels: WidgetPanelMetadata[]): WidgetPanelMetadata[] {
  return panels.map((panel) => ({ ...panel }));
}

function normalizeDevicePanels(panels: WidgetPanelMetadata[] | undefined): WidgetPanelMetadata[] {
  const systemIds = new Set(DEFAULT_DEVICE_PANELS.map((panel) => panel.id));
  const customPanels = (panels ?? [])
    .filter((panel) => panel.kind === "custom" && !systemIds.has(panel.id))
    .map((panel, index) => ({
      id: panel.id,
      name: panel.name.trim().slice(0, 80) || `自定义面板 ${index + 1}`,
      kind: "custom" as const,
      order: DEFAULT_DEVICE_PANELS.length + index
    }));
  return [...cloneDevicePanels(DEFAULT_DEVICE_PANELS), ...customPanels];
}

function createDynamicLayout(source: WidgetLayoutDocument | undefined): WidgetLayoutDocument {
  if (!source) return { version: 4, placements: {}, catalog: {}, snapToGrid: true };
  const removedSystemIds = new Set(Object.entries(source.catalog).filter(([, entry]) => entry.config?.systemRendered === true && entry.config.deleted === true).map(([id]) => id));
  const catalog = Object.fromEntries(Object.entries(source.catalog)
    .filter(([, entry]) => Boolean(entry.widgetType) && !removedSystemIds.has(entry.groupId ?? ""))
    .map(([id, entry]) => {
      const config = entry.config ? { ...entry.config } : undefined;
      if (config) {
        delete config.systemRendered;
        delete config.deleted;
      }
      return [id, { ...entry, ...(config && Object.keys(config).length ? { config } : {}) }];
    }));
  const placements = Object.fromEntries(Object.entries(source.placements).filter(([id]) => Boolean(catalog[id])).map(([id, placement]) => [id, { ...placement }]));
  return { version: 4, placements, catalog, snapToGrid: source.snapToGrid };
}

function createStarterDynamicLayout(): WidgetLayoutDocument {
  // Instance-backed widgets must be added through the drawer so the user can
  // bind each one to an exact CPU, disk, GPU, fan or network device.
  return { version: 4, placements: {}, catalog: {}, snapToGrid: true };
}

function WidgetPanelBar({
  panels,
  activePanelId,
  editable,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete
}: {
  panels: WidgetPanelMetadata[];
  activePanelId: string;
  editable: boolean;
  onSelect: (panelId: string) => void;
  onCreate: (name: string) => void;
  onRename: (panelId: string, name: string) => void;
  onDuplicate: (panelId: string, layout?: WidgetLayoutDocument) => void;
  onDelete: (panelId: string) => void;
}) {
  const layout = useOptionalWidgetLayout();
  const canManage = editable && layout?.editMode === true;
  const [manageOpen, setManageOpen] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const managerRef = useRef<HTMLDivElement>(null);
  const [renameTarget, setRenameTarget] = useState<WidgetPanelMetadata | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WidgetPanelMetadata | null>(null);

  useEffect(() => {
    if (!canManage) setManageOpen(false);
  }, [canManage]);

  useEffect(() => {
    if (!manageOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !managerRef.current?.contains(event.target)) setManageOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManageOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [manageOpen]);

  const submitNewPanel = (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    const name = newPanelName.trim();
    if (!name) return;
    onCreate(name);
    setNewPanelName("");
  };

  return (
    <>
    <div className="workspace-panel-bar">
      <M3Tabs
        className="workspace-tabs"
        options={panels.map((panel) => ({
          value: panel.id,
          label: <><span aria-hidden="true">{panel.id === "overview" && <Icon name="overview" size={15} />}{panel.id === "compute" && <Icon name="device" size={15} />}{panel.id === "storage_net" && <Icon name="data" size={15} />}{panel.id === "gpu_thermal" && <Icon name="hub" size={15} />}{panel.id === "fan" && <Icon name="clock" size={15} />}</span>{panel.name}</>
        }))}
        value={activePanelId}
        onChange={onSelect}
        aria-label="设备面板"
      />
      <div ref={managerRef} className="workspace-panel-manager">
        <button className={`workspace-layout-actions__button${manageOpen ? " is-active" : ""}`} type="button" onClick={() => setManageOpen((value) => !value)} aria-expanded={manageOpen} disabled={!canManage} title={canManage ? "管理自定义面板" : "请先进入编辑排布模式后管理面板"}>面板管理</button>
        {manageOpen && (
          <div className="workspace-panel-manager__tray">
            <div className="workspace-panel-manager__heading"><strong>我的面板</strong><span>系统面板保留兼容；自定义面板可以重复、重命名或删除。</span></div>
            <form className="workspace-panel-manager__create" onSubmit={submitNewPanel}>
              <M3TextField className="workspace-panel-manager__field" label="新面板名称" value={newPanelName} onChange={(event) => setNewPanelName(event.target.value)} placeholder="例如：值班视图" maxLength={80} />
              <Button className="workspace-panel-manager__create-button" variant="secondary" type="submit" disabled={!newPanelName.trim()}>新建</Button>
            </form>
            <div className="workspace-panel-manager__list">{panels.map((panel) => <div className="workspace-panel-manager__item" key={panel.id}><span><strong>{panel.name}</strong><small>{panel.kind === "custom" ? "自定义面板" : "系统面板"}</small></span><div>{panel.kind === "custom" && <><button type="button" onClick={() => setRenameTarget(panel)}>重命名</button><button type="button" onClick={() => onDuplicate(panel.id, activePanelId === panel.id ? layout?.getLayoutSnapshot() : undefined)}>复制</button><button type="button" className="is-danger" onClick={() => setDeleteTarget(panel)}>删除</button></>}{panel.kind === "system" && <button type="button" onClick={() => onDuplicate(panel.id, activePanelId === panel.id ? layout?.getLayoutSnapshot() : undefined)}>复制为自定义</button>}</div></div>)}</div>
          </div>
        )}
      </div>
    </div>
    {renameTarget && <PromptDialog title={`重命名“${renameTarget.name}”`} detail="名称只用于当前设备的面板列表，最多 80 个字符。" initialValue={renameTarget.name} onConfirm={(name) => { onRename(renameTarget.id, name); setRenameTarget(null); }} onCancel={() => setRenameTarget(null)} />}
    {deleteTarget && <ConfirmDialog title={`删除“${deleteTarget.name}”？`} detail="删除自定义面板后，其中的小组件布局也会从当前设备的面板列表中移除。" confirmLabel="删除面板" onConfirm={() => { onDelete(deleteTarget.id); setDeleteTarget(null); }} onCancel={() => setDeleteTarget(null)} />}
    </>
  );
}

const temperatureRoleLabels: Record<string, string> = {
  cpu_package: "CPU 封装",
  cpu_core: "CPU 核心",
  gpu_core: "GPU 核心",
  gpu_hotspot: "GPU 热点",
  storage_composite: "磁盘综合温度",
  storage_sensor: "磁盘附加传感器",
  motherboard: "主板温度",
  superio: "SuperIO 温度",
  peci: "PECI 温度",
  acpi_zone: "ACPI 热区",
  threshold: "温度阈值",
  derived: "派生温度",
  unknown: "未知温度源"
};

const temperatureSourceLabels: Record<string, string> = {
  librehardwaremonitor: "LibreHardwareMonitor",
  "linux-hwmon": "Linux hwmon",
  "linux-thermal": "Linux thermal",
  smartctl: "smartctl / SMART",
  "windows-storage-reliability": "Windows 存储可靠性",
  "cpu-package-shared": "CPU Package 共享",
};

function temperatureStatusLabel(status: TemperatureSensorReading["status"]): string {
  if (status === "valid") return "正常";
  if (status === "threshold") return "阈值";
  if (status === "invalid") return "无效值";
  return "不可用";
}

function temperatureSourceLabel(source: string): string {
  return temperatureSourceLabels[source] ?? (source || "未知来源");
}

function temperatureValueLabel(sensor: TemperatureSensorReading): string {
  if (sensor.currentC == null || !Number.isFinite(sensor.currentC)) {
    return sensor.status === "threshold" ? "仅阈值" : "—";
  }
  return `${sensor.currentC.toFixed(1)} °C`;
}

function temperatureLimitsLabel(sensor: TemperatureSensorReading): string {
  const limits = [
    sensor.highC != null ? `高 ${sensor.highC.toFixed(1)}°C` : "",
    sensor.criticalC != null ? `临界 ${sensor.criticalC.toFixed(1)}°C` : "",
    sensor.emergencyC != null ? `紧急 ${sensor.emergencyC.toFixed(1)}°C` : ""
  ].filter(Boolean);
  return limits.join(" · ");
}

function TemperatureSourcesPanel({
  sensors,
  series
}: {
  sensors: TemperatureSensorReading[];
  series: TemperatureMetricSeries[];
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const visibleSensors = useMemo(
    () => sensors.filter((sensor) => showDiagnostics || sensor.status === "valid"),
    [sensors, showDiagnostics]
  );
  const chartableSeries = useMemo(
    () => series.filter((sensor) => sensor.currentC.length > 0 && (showDiagnostics || sensor.status === "valid")),
    [series, showDiagnostics]
  );
  const selectedSeries = chartableSeries.find((sensor) => sensor.id === selectedId) ?? chartableSeries[0];

  useEffect(() => {
    if (!selectedSeries || selectedSeries.id === selectedId) return;
    setSelectedId(selectedSeries.id);
  }, [selectedId, selectedSeries]);

  if (!sensors.length && !series.length) return null;

  return (
    <DesktopWidget id="temperature-sources" title="温度源" kind="group" defaultSize="large">
      <Surface className="workspace-temperature-sources">
        <div className="workspace-surface__header">
          <div>
            <span className="workspace-section-kicker">温度源</span>
            <h3>全部温度传感器</h3>
          </div>
          <M3Checkbox
            className="workspace-temperature-toggle"
            compact
            checked={showDiagnostics}
            onCheckedChange={setShowDiagnostics}
            label="显示诊断通道"
          />
        </div>
        <p className="workspace-surface__description">按传感器原始名称和采集后端展示；不同来源不会合并平均，阈值和无效值默认隐藏。</p>
        <div className="workspace-temperature-sources__body">
          <div className="workspace-temperature-source-list">
            {visibleSensors.length ? visibleSensors.map((sensor) => {
              const isSelected = sensor.id === selectedSeries?.id;
              return (
                <button
                  type="button"
                  key={sensor.id}
                  className={`workspace-temperature-source-row${isSelected ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(sensor.id)}
                >
                  <span className="workspace-temperature-source-row__identity">
                    <strong>{sensor.displayName || sensor.rawName}</strong>
                    <small>{temperatureRoleLabels[sensor.role] ?? sensor.role} · {temperatureSourceLabel(sensor.source)}</small>
                  </span>
                  <span className="workspace-temperature-source-row__value">
                    <strong>{temperatureValueLabel(sensor)}</strong>
                    <small className={`workspace-temperature-status workspace-temperature-status--${sensor.status}`}>{temperatureStatusLabel(sensor.status)}</small>
                    {temperatureLimitsLabel(sensor) && <small>{temperatureLimitsLabel(sensor)}</small>}
                  </span>
                </button>
              );
            }) : <div className="workspace-telemetry-empty">当前只有无效或诊断温度通道</div>}
          </div>
          <div className="workspace-temperature-source-chart">
            {selectedSeries ? (
              <TelemetryChartCard
                title={`${selectedSeries.name} · 历史`}
                subtitle={`${temperatureRoleLabels[selectedSeries.role] ?? selectedSeries.role} · ${temperatureSourceLabel(selectedSeries.source)}`}
                series={[{ label: "温度", points: selectedSeries.currentC, valueFormatter: (value) => `${value.toFixed(1)} °C` }]}
                valueFormatter={(value) => `${value.toFixed(1)} °C`}
                emptyMessage="等待有效温度样本"
              />
            ) : <div className="workspace-trend-empty">选择一个有效温度源查看历史</div>}
          </div>
        </div>
      </Surface>
    </DesktopWidget>
  );
}

function AgentTemperatureSourcesPanel({
  sensors,
  backends,
  probeError
}: {
  sensors: TemperatureSensorReading[];
  backends: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  probeError?: string;
}) {
  return (
    <Surface className="workspace-agent-temperature-sources">
      <div className="workspace-surface__header">
        <div>
          <span className="workspace-section-kicker">温度探测</span>
          <h3>已发现温度源</h3>
        </div>
        <span className="workspace-caption">{sensors.length} 个源</span>
      </div>
      <p className="workspace-surface__description">这里展示本机探测到的全部温度源，不按 CPU/GPU 平均合并。有效值、阈值、无效值和核显共享 CPU Package 的来源都会保留。</p>
      <div className="workspace-agent-temperature-sources__body">
        {sensors.length ? (
          <div className="workspace-temperature-source-list">
            {sensors.map((sensor) => (
              <div className="workspace-temperature-source-row" key={sensor.id}>
                <span className="workspace-temperature-source-row__identity">
                  <strong>{sensor.displayName || sensor.rawName}</strong>
                  <small>{temperatureRoleLabels[sensor.role] ?? sensor.role} · {temperatureSourceLabel(sensor.source)}{sensor.backend ? ` · ${sensor.backend}` : ""}</small>
                  {sensor.path && <small>{sensor.path}</small>}
                </span>
                <span className="workspace-temperature-source-row__value">
                  <strong>{temperatureValueLabel(sensor)}</strong>
                  <small className={`workspace-temperature-status workspace-temperature-status--${sensor.status}`}>{temperatureStatusLabel(sensor.status)}</small>
                  {temperatureLimitsLabel(sensor) && <small>{temperatureLimitsLabel(sensor)}</small>}
                </span>
              </div>
            ))}
          </div>
        ) : <div className="workspace-muted-block">{probeError ? `温度探测失败：${probeError}` : "尚未返回温度源，请点击上方“重新检测硬件”。"}</div>}
        {backends.length ? (
          <div className="workspace-agent-temperature-backends">
            <strong>探测后端</strong>
            {backends.map((backend) => (
              <div className="workspace-agent-temperature-backend" key={backend.id}>
                <span className={backend.ok ? "is-enabled" : "is-disabled"}>{backend.ok ? "可用" : "不可用"}</span>
                <div><strong>{backend.label}</strong>{backend.detail && <small>{backend.detail}</small>}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Surface>
  );
}
function InstanceRow({ label, name, value }: { label: string; name: string; value: string }) {
  return <div className="workspace-instance-row"><span className="workspace-instance-row__label">{label}</span><span className="workspace-instance-row__name">{name}</span><strong>{value}</strong></div>;
}

function LoadingSurface() {
  return <div className="workspace-page workspace-loading-state" role="status" aria-busy="true" aria-label="正在加载设备状态"><span className="workspace-visually-hidden">正在加载设备状态</span><div className="workspace-skeleton workspace-skeleton--hero" /><div className="workspace-skeleton workspace-skeleton--large" /><div className="workspace-skeleton workspace-skeleton--medium" /></div>;
}

function EmptyState({ title, detail, action, tone = "neutral" }: { title: string; detail: string; action?: React.ReactNode; tone?: "neutral" | "error" }) {
  return <section className={`workspace-empty m3-state-surface m3-state-surface--${tone}`} role={tone === "error" ? "alert" : "status"}><div className="workspace-empty__mark"><Icon name={tone === "error" ? "warning" : "overview"} size={22} /></div><h3>{title}</h3><p>{detail}</p>{action}</section>;
}

function ErrorSurface({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <EmptyState tone="error" title={title} detail={detail} action={<Button variant="primary" onClick={onRetry}><Icon name="refresh" size={16} />重试</Button>} />;
}



export {
  appIconSrc,
  isMetricUnavailable,
  unavailablePoints,
  formatVirtualizationStorageType,
  formatVirtualizationStorageValue,
  formatVirtualizationStoragePercent,
  formatVirtualizationStorageCapacity,
  latestSampleValue,
  metricGroups,
  instanceMetricOptions,
  probeTargetLabels,
  probeProviderLabels,
  DEFAULT_DEVICE_PANELS,
  PageIntro,
  DeviceDirectoryFilterBar,
  CarbonDeviceTable,
  ConfirmDialog,
  PromptDialog,
  OverviewSummary,
  TelemetrySection,
  mergeFanMetricSeries,
  TelemetryDeviceBlock,
  TelemetryModelList,
  CpuFactsCard,
  InstanceFilter,
  InstanceMetricOverride,
  TrafficCalendarCard,
  MetricWindowControl,
  cloneDevicePanels,
  normalizeDevicePanels,
  createDynamicLayout,
  createStarterDynamicLayout,
  WidgetPanelBar,
  temperatureStatusLabel,
  temperatureSourceLabel,
  temperatureValueLabel,
  temperatureLimitsLabel,
  TemperatureSourcesPanel,
  AgentTemperatureSourcesPanel,
  InstanceRow,
  LoadingSurface,
  EmptyState,
  ErrorSurface
};
