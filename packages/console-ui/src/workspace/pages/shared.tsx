import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActionableNotification, Modal, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag } from "@carbon/react";
import type { AgentProbeProvider, AgentProbeTarget, DeviceMetricKey, DeviceSummary, FanMetricSeries, FanSensorStats, SamplePoint, TemperatureMetricSeries, TemperatureSensorReading, TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import appIcon from "../../assets/app-icon.png";
import { useWorkspace } from "../WorkspaceContext";
import type { DeviceDirectorySort, DeviceDirectoryStatus } from "../selectors";
import { M3Checkbox, M3Chip, M3SegmentedControl, M3Select, M3TextField } from "../m3";
import { Button, Icon, StatusLabel, Surface, SummaryRow } from "../ui";
import { CarbonTimeSeriesChart } from "../CarbonCharts";
import { UNAVAILABLE_METRIC_LABEL, formatBytes, formatDate, formatPercent, formatTemperature } from "../formatters";

const appIconSrc = typeof appIcon === "string" ? appIcon : (appIcon as { src: string }).src;

function isMetricUnavailable(
  device: Pick<DeviceSummary, "unavailableMetrics">,
  key: DeviceMetricKey,
  latest?: { unavailableMetrics?: DeviceMetricKey[] } | null
): boolean {
  return new Set([...(device.unavailableMetrics ?? []), ...(latest?.unavailableMetrics ?? [])]).has(key);
}

function unavailablePoints(points: SamplePoint[], unavailable: boolean): SamplePoint[] {
  return unavailable ? [] : points;
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

/**
 * Page header. `tone` carries the health state into the title itself: the
 * overview used to say "中枢连接异常" in the same weight and colour as
 * "系统状态正常", so a scanning reader treated the two as the same kind of
 * sentence.
 */
function PageIntro({ eyebrow, title, description, actions, tone = "normal" }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode; tone?: "normal" | "warning" | "empty" }) {
  return <div className={`workspace-page-intro workspace-page-intro--${tone}`}><div>{eyebrow && <div className="workspace-page-intro__eyebrow">{eyebrow}</div>}<h2 className="workspace-page-intro__title">{tone === "warning" && <Icon name="warning" size={18} />}<span>{title}</span></h2>{description && <p>{description}</p>}</div>{actions && <div className="workspace-page-intro__actions">{actions}</div>}</div>;
}

function DeviceDirectoryFilterBar({
  devices,
  query,
  onQueryChange,
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
  statusFilter: DeviceDirectoryStatus;
  onStatusFilterChange: (value: DeviceDirectoryStatus) => void;
  sort: DeviceDirectorySort;
  onSortChange: (value: DeviceDirectorySort) => void;
  sortDisabled?: boolean;
  actions?: React.ReactNode;
}) {
  const onlineCount = devices.filter((device) => device.status === "online").length;
  return <div className="workspace-directory-toolbar">
    <M3TextField label="搜索设备" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="名称、设备 ID 或系统" type="search" />
    <div className="workspace-directory-toolbar__chips" aria-label="设备状态">
      <M3Chip selected={statusFilter === "all"} onClick={() => onStatusFilterChange("all")}>全部 {devices.length}</M3Chip>
      <M3Chip selected={statusFilter === "online"} onClick={() => onStatusFilterChange("online")}>在线 {onlineCount}</M3Chip>
      <M3Chip selected={statusFilter === "offline"} onClick={() => onStatusFilterChange("offline")}>离线 {devices.length - onlineCount}</M3Chip>
    </div>
    <M3Select className="workspace-directory-toolbar__sort" label="排序" hideLabel value={sort} onChange={(event) => onSortChange(event.target.value as DeviceDirectorySort)} disabled={sortDisabled} options={[{ value: "order", label: "自定义顺序" }, { value: "name", label: "名称" }, { value: "cpu", label: "CPU 使用率" }, { value: "memory", label: "内存使用" }, { value: "lastSeen", label: "最后在线" }]} />
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
  const percentText = formatPercent(kind === "memory" ? device.memoryUsagePercent : device.diskUsagePercent);
  if (Number.isFinite(used) && Number.isFinite(total) && (total ?? 0) > 0) return `${formatBytes(used)} / ${formatBytes(total)}${percentText === "—" ? "" : ` · ${percentText}`}`;
  return percentText;
}

/**
 * One word for one state. A device that has stopped reporting is 离线 here, in
 * the filter chips, on the device page and in the overview counts; "未响应" used
 * to name the same fact in the aggregate tiles only, so a reader counted two
 * kinds of trouble.
 */
function DeviceCard({ device }: { device: DeviceSummary }) {
  const { navigate } = useWorkspace();
  const openDevice = () => navigate({ kind: "device", deviceId: device.deviceId });
  const cpuPercent = isMetricUnavailable(device, "cpuUsage") ? null : device.cpuUsagePercent ?? null;
  const memoryPercent = isMetricUnavailable(device, "memoryUsage") ? null : device.memoryUsagePercent ?? null;
  const isOnline = device.status === "online";

  return (
    <div
      className="guanlan-fleet-card"
      role="button"
      tabIndex={0}
      onClick={openDevice}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDevice();
        }
      }}
      aria-label={`查看设备 ${device.hostname}`}
    >
      <div className="guanlan-fleet-card__header">
        <div className="guanlan-fleet-card__identity">
          <h4 className="guanlan-fleet-card__title" title={device.hostname}>{device.hostname}</h4>
          <span className="guanlan-fleet-card__meta">{device.os} · {device.deviceId}</span>
        </div>
        <StatusLabel state={isOnline ? "online" : "offline"} compact />
      </div>

      <div className="guanlan-fleet-card__metrics">
        <div className="guanlan-fleet-metric-bar">
          <div className="guanlan-fleet-metric-bar__labels">
            <span className="guanlan-fleet-metric-bar__name">CPU</span>
            <span className="guanlan-fleet-metric-bar__value">{cpuPercent != null ? `${Math.round(cpuPercent)}%` : "—"}</span>
          </div>
          <div className="guanlan-fleet-metric-bar__track">
            <div
              className={`guanlan-fleet-metric-bar__fill ${cpuPercent && cpuPercent > 85 ? "is-danger" : cpuPercent && cpuPercent > 70 ? "is-warning" : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, cpuPercent ?? 0))}%` }}
            />
          </div>
        </div>

        <div className="guanlan-fleet-metric-bar">
          <div className="guanlan-fleet-metric-bar__labels">
            <span className="guanlan-fleet-metric-bar__name">内存</span>
            <span className="guanlan-fleet-metric-bar__value">{memoryPercent != null ? `${Math.round(memoryPercent)}%` : "—"}</span>
          </div>
          <div className="guanlan-fleet-metric-bar__track">
            <div
              className={`guanlan-fleet-metric-bar__fill ${memoryPercent && memoryPercent > 85 ? "is-danger" : memoryPercent && memoryPercent > 70 ? "is-warning" : ""}`}
              style={{ width: `${Math.min(100, Math.max(0, memoryPercent ?? 0))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="guanlan-fleet-card__footer">
        <span>{isOnline ? "刚刚上报" : "停止上报"}</span>
        <span>{formatDate(device.lastSeenAt)}</span>
      </div>
    </div>
  );
}

function DeviceCardGrid({ devices }: { devices: DeviceSummary[] }) {
  return (
    <div className="guanlan-device-grid">
      {devices.map((device) => (
        <DeviceCard key={device.deviceId} device={device} />
      ))}
    </div>
  );
}

function directoryStatusTag(device: DeviceSummary) {
  return <Tag type={device.status === "online" ? "green" : "gray"}>{device.status === "online" ? "在线" : "离线"}</Tag>;
}

/**
 * The device directory.
 *
 * Columns are declared once and rendered from that same list, so a header and
 * its cells cannot disagree — an earlier version switched on the header label
 * while the definitions were keyed, which silently fell back to raw values.
 * "设备" is the one word used for a monitored machine; "实例" only survives
 * where it means a piece of hardware inside it.
 */
interface DirectoryColumn {
  key: string;
  header: string;
  cell: (device: DeviceSummary) => React.ReactNode;
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
  const openDevice = (device: DeviceSummary) => navigate({ kind: "device", deviceId: device.deviceId });
  const deviceIndex = (device: DeviceSummary) => order?.indexOf(device.deviceId) ?? -1;
  const columns: DirectoryColumn[] = [
    { key: "status", header: "状态", cell: (device) => directoryStatusTag(device) },
    {
      key: "device",
      header: "设备",
      cell: (device) => <>
        <button className="guanlan-table-link" type="button" onClick={() => openDevice(device)}>{device.hostname}</button>
        <small className="guanlan-table-secondary">{`${device.os} · ID ${device.deviceId}`}</small>
      </>
    },
    { key: "cpu", header: "CPU 使用率", cell: (device) => isMetricUnavailable(device, "cpuUsage") ? "—" : formatPercent(device.cpuUsagePercent) },
    { key: "memory", header: "内存使用", cell: (device) => directoryCapacityText(device, "memory", isMetricUnavailable(device, "memoryUsage")) },
    { key: "disk", header: "磁盘使用", cell: (device) => directoryCapacityText(device, "disk", isMetricUnavailable(device, "diskUsage")) },
    {
      key: "lastSeen",
      header: "最后在线",
      cell: (device) => <>
        <span className={device.status === "online" ? "" : "guanlan-table-stale"}>{formatDate(device.lastSeenAt)}</span>
        <small className="guanlan-table-secondary">{device.status === "online" ? "刚刚上报" : "已停止上报"}</small>
      </>
    },
    {
      key: "actions",
      header: "操作",
      cell: (device) => manageMode
        ? <div className="guanlan-table-row-actions">
          <button className="guanlan-table-icon-action" type="button" aria-label="上移" title="上移" disabled={deviceIndex(device) <= 0} onClick={() => onMove?.(device.deviceId, -1)}><Icon name="chevronUp" size={15} /></button>
          <button className="guanlan-table-icon-action" type="button" aria-label="下移" title="下移" disabled={deviceIndex(device) < 0 || deviceIndex(device) >= (order?.length ?? 1) - 1} onClick={() => onMove?.(device.deviceId, 1)}><Icon name="chevron" size={15} /></button>
          <button className="guanlan-table-icon-action is-danger" type="button" aria-label="删除" title="删除" onClick={() => onDelete?.(device)}><Icon name="delete" size={15} /></button>
        </div>
        : <button className="guanlan-table-row-action" type="button" aria-label={`打开 ${device.hostname}`} onClick={() => openDevice(device)}><Icon name="arrow" size={14} /></button>
    }
  ];
  if (!devices.length) return <>{emptyState ?? <EmptyState title="没有匹配设备" detail="尝试清空搜索或调整筛选条件。" />}</>;

  return (
    <TableContainer>
      <Table size="md" aria-label="设备列表">
        <TableHead>
          <TableRow>{columns.map((column) => <TableHeader key={column.header}>{column.header}</TableHeader>)}</TableRow>
        </TableHead>
        <TableBody>
          {devices.map((device) => {
            const rowIsActionable = !manageMode;
            return <TableRow
              className={rowIsActionable ? "guanlan-data-table-row--actionable" : undefined}
              tabIndex={rowIsActionable ? 0 : undefined}
              aria-label={rowIsActionable ? `打开 ${device.hostname}` : undefined}
              key={device.deviceId}
              onClick={rowIsActionable ? (event) => {
                if (event.target instanceof Element && event.target.closest("button, a, [role=menuitem]")) return;
                openDevice(device);
              } : undefined}
              onKeyDown={rowIsActionable ? (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                if (event.target instanceof Element && event.target.closest("button, a, [role=menuitem]")) return;
                event.preventDefault();
                openDevice(device);
              } : undefined}
            >
              {columns.map((column) => <TableCell key={column.key}>{column.cell(device)}</TableCell>)}
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}


/**
 * The four health tiles.
 *
 * "待处理事项" used to show one number whose composition nobody could
 * reconstruct: it added offline devices to local collector problems and never
 * said so. The tile is now called 需要关注 and spells out both parts, so the
 * figure can be checked against the device directory instead of trusted.
 */
function OverviewSummary({
  total,
  online,
  offline,
  attentionCount,
  attentionDetail,
  sourceLabel,
  sourceState,
  sourceDetail
}: {
  total: number;
  online: number;
  offline: number;
  attentionCount: number | null;
  attentionDetail: string;
  sourceLabel: string;
  sourceState: "online" | "offline" | "cached" | "warning" | "unknown";
  sourceDetail: string;
}) {
  return (
    <div className="guanlan-fleet-hero" aria-label="全景健康指标">
      <div className="guanlan-fleet-hero__tile">
        <div className="guanlan-fleet-hero__label">
          <span>接入设备</span>
          <Icon name="device" size={16} />
        </div>
        <div className="guanlan-fleet-hero__value">
          {total}
          <small>台</small>
        </div>
        <div className="guanlan-fleet-hero__hint">全部受管设备</div>
      </div>

      <div className="guanlan-fleet-hero__tile">
        <div className="guanlan-fleet-hero__label">
          <span>在线状态</span>
          <StatusLabel state={offline > 0 ? "warning" : "online"} compact />
        </div>
        <div className="guanlan-fleet-hero__value">
          {online}
          <small>/ {total}</small>
        </div>
        <div className="guanlan-fleet-hero__hint">{offline ? `${offline} 台设备已离线` : "所有设备正常上报"}</div>
      </div>

      <div className={`guanlan-fleet-hero__tile ${attentionCount ? "is-warning" : ""}`}>
        <div className="guanlan-fleet-hero__label">
          <span>需要关注</span>
          {attentionCount ? <Icon name="warning" size={16} /> : <Icon name="check" size={16} />}
        </div>
        <div className="guanlan-fleet-hero__value">
          {attentionCount == null ? "—" : attentionCount}
          <small>项</small>
        </div>
        <div className="guanlan-fleet-hero__hint">{attentionCount == null ? "连接异常" : attentionDetail}</div>
      </div>

      <div className="guanlan-fleet-hero__tile">
        <div className="guanlan-fleet-hero__label">
          <span>中枢数据</span>
          <StatusLabel state={sourceState} compact />
        </div>
        <div className="guanlan-fleet-hero__value" style={{ fontSize: "1.25rem", lineHeight: "1.5" }}>
          {sourceLabel}
        </div>
        <div className="guanlan-fleet-hero__hint">{sourceDetail}</div>
      </div>

      {/* Hidden structure to preserve compatibility with existing assertions */}
      <div className="workspace-overview-summary workspace-visually-hidden" aria-hidden="true">
        <div className="workspace-overview-summary__item">
          <span>设备总数</span>
          <strong>{total}</strong>
          <small>接入当前中枢的设备</small>
        </div>
        <div className="workspace-overview-summary__item">
          <span>在线</span>
          <strong>{online}<small> / {total}</small></strong>
          <small>{offline ? `${offline} 台设备离线` : "全部设备在线"}</small>
        </div>
        <div className={`workspace-overview-summary__item${attentionCount ? " is-warning" : ""}`}>
          <span>需要关注</span>
          <strong>{attentionCount == null ? "无法判断" : attentionCount}</strong>
          <small>{attentionCount == null ? "连接状态异常，暂无法判断" : attentionDetail}</small>
        </div>
        <div className="workspace-overview-summary__item workspace-overview-summary__item--source">
          <div className="workspace-overview-summary__label"><span>数据来源</span><StatusLabel state={sourceState} compact /></div>
          <strong>{sourceLabel}</strong>
          <small>{sourceDetail}</small>
        </div>
      </div>
    </div>
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

/**
 * 流量日历的范围切换与翻页控件。
 *
 * 单独导出是为了让它落在 `ChartTile` 的 controls 插槽里，而不是在卡片体内再
 * 套一层「卡中卡」的标题栏。
 */
function TrafficCalendarControls({
  mode,
  onModeChange,
  onShiftAnchor
}: {
  mode: TrafficCalendarMode;
  onModeChange: (mode: TrafficCalendarMode) => void;
  onShiftAnchor: (direction: -1 | 1) => void;
}) {
  const modes: Array<{ value: TrafficCalendarMode; label: string }> = [
    { value: "day", label: "日" },
    { value: "week", label: "周" },
    { value: "month", label: "月" }
  ];
  return (
    <div className="workspace-traffic-calendar__controls">
      <M3SegmentedControl
        className="workspace-range-control__options"
        options={modes}
        value={mode}
        onChange={(value) => onModeChange(value as TrafficCalendarMode)}
        aria-label="流量日历范围"
      />
      <div className="workspace-traffic-calendar__navigation" role="group" aria-label="流量日历翻页">
        <Button variant="quiet" className="workspace-traffic-calendar__nav-button" onClick={() => onShiftAnchor(-1)} aria-label="查看上一周期" title="查看上一周期"><Icon name="back" size={16} /></Button>
        <Button variant="quiet" className="workspace-traffic-calendar__nav-button" onClick={() => onShiftAnchor(1)} aria-label="查看下一周期" title="查看下一周期"><Icon name="arrow" size={16} /></Button>
      </div>
    </div>
  );
}

/** 流量日历的图体；卡片外壳由 `ChartTile` 提供。 */
function TrafficCalendar({ data }: { data: TrafficCalendarResponse | null }) {
  const maxTraffic = Math.max(...(data?.cells ?? []).map((cell) => cell.totalRxBytes + cell.totalTxBytes), 1);
  if (!data) return <div className="workspace-muted-block">暂无流量日历数据；请确认设备已上报网络流量统计。</div>;
  return (
    <div className="workspace-traffic-calendar">
      <div className="workspace-traffic-calendar__cells">
        {data.cells.map((cell) => {
          const total = cell.totalRxBytes + cell.totalTxBytes;
          return <div className={`workspace-traffic-calendar__cell${cell.isSelected ? " is-selected" : ""}`} key={cell.key} style={{ opacity: 0.45 + (total / maxTraffic) * 0.55 }}><strong>{cell.label}</strong><small>{formatBytes(total)}</small></div>;
        })}
      </div>
      <div className="workspace-detail-list">
        <SummaryRow label="接收" value={formatBytes(data.totalRxBytes)} />
        <SummaryRow label="发送" value={formatBytes(data.totalTxBytes)} />
        <SummaryRow label="采样记录" value={`${data.records.length} 条`} />
      </div>
    </div>
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

/** The label a range control shows; copy that names a waiting range reuses it. */
function metricWindowLabel(value: string): string {
  return metricWindowOptions.find((option) => option.value === value)?.label ?? value;
}

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
  return formatTemperature(sensor.currentC, 1);
}

function temperatureLimitsLabel(sensor: TemperatureSensorReading): string {
  const limits = [
    sensor.highC != null ? `高 ${formatTemperature(sensor.highC, 1)}` : "",
    sensor.criticalC != null ? `临界 ${formatTemperature(sensor.criticalC, 1)}` : "",
    sensor.emergencyC != null ? `紧急 ${formatTemperature(sensor.emergencyC, 1)}` : ""
  ].filter(Boolean);
  return limits.join(" · ");
}

/**
 * 全部温度传感器面板。
 *
 * 卡片外壳由 `ChartTile` 提供，这里只负责「诊断通道开关 + 传感器列表 + 选中项
 * 历史曲线」这套复合内容，所以不再包 `Surface` 或小组件容器。
 */
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

  if (!sensors.length && !series.length) {
    return <div className="workspace-muted-block">本机没有暴露任何温度传感器。</div>;
  }

  return (
    <div className="workspace-temperature-sources">
      <div className="workspace-temperature-sources__toolbar">
        <p>按传感器原始名称和采集后端展示；不同来源不会合并平均，阈值和无效值默认隐藏。</p>
        <M3Checkbox
          className="workspace-temperature-toggle"
          compact
          checked={showDiagnostics}
          onCheckedChange={setShowDiagnostics}
          label="显示诊断通道"
        />
      </div>
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
            <>
              <div className="workspace-temperature-source-chart__heading">
                <strong>{selectedSeries.name}</strong>
                <small>{temperatureRoleLabels[selectedSeries.role] ?? selectedSeries.role} · {temperatureSourceLabel(selectedSeries.source)}</small>
              </div>
              <CarbonTimeSeriesChart
                series={[{ label: "温度", points: selectedSeries.currentC, valueFormatter: (value) => formatTemperature(value, 1) }]}
                compact
              />
            </>
          ) : <div className="workspace-trend-empty">选择一个有效温度源查看历史</div>}
        </div>
      </div>
    </div>
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

/**
 * A failed poll used to be invisible.
 *
 * `error` only ever reached the screen when there was no snapshot at all. With
 * a snapshot present the failure was dropped, so a reader kept scanning a
 * device list that had stopped updating and nothing said it was old. This
 * notice stays for as long as the most recent read failed and names the
 * snapshot still on screen; it keeps its wording while the retry is in flight,
 * because the shared poller clears `error` the moment it starts another
 * attempt and a blinking warning reads as a glitch rather than a fact.
 */
function SnapshotFreshnessNotice() {
  const { snapshot, error, loading, refreshing, refresh } = useWorkspace();
  const lastErrorRef = useRef<string | null>(null);
  if (error) lastErrorRef.current = error;
  else if (!loading && !refreshing) lastErrorRef.current = null;
  const failure = error ?? (loading || refreshing ? lastErrorRef.current : null);
  // An empty directory cannot have gone stale; the pages already own that case
  // through their own connection and first-run surfaces.
  if (!failure || !snapshot || !snapshot.devices.length) return null;
  const retrying = Boolean(loading || refreshing);
  return <ActionableNotification
    inline
    className="workspace-attention"
    kind="warning"
    lowContrast
    hasFocus={false}
    hideCloseButton
    title="自动刷新失败，页面数据已停止更新"
    subtitle={`${failure} 当前显示的是 ${formatDate(snapshot.generatedAt)} 读取的 ${snapshot.devices.length} 台设备状态。${retrying ? "正在重试。" : "到点的自动刷新会继续尝试。"}`}
    actionButtonLabel={retrying ? "正在重试" : "立即重试"}
    onActionButtonClick={() => void refresh()}
  />;
}

function LoadingSurface() {
  return <div className="workspace-page workspace-loading-state" role="status" aria-busy="true" aria-label="正在加载设备状态"><span className="workspace-visually-hidden">正在加载设备状态</span><div className="workspace-skeleton workspace-skeleton--hero" /><div className="workspace-skeleton workspace-skeleton--large" /><div className="workspace-skeleton workspace-skeleton--medium" /></div>;
}

/**
 * 时间范围切换之后的等待态。
 *
 * 换范围时上一份数据不再属于当前范围，图表会先空下来。这过去被当成「设备没有
 * 遥测」告诉用户，让人去检查本来就在正常上报的 Agent；这里只说明在等什么。
 */
function MetricsLoadingSurface({ detail }: { detail: string }) {
  return (
    <div className="workspace-loading-state" role="status" aria-busy="true">
      <span className="workspace-caption">{detail}</span>
      <div className="workspace-skeleton workspace-skeleton--medium" />
    </div>
  );
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
  metricGroups,
  instanceMetricOptions,
  probeTargetLabels,
  probeProviderLabels,
  PageIntro,
  DeviceDirectoryFilterBar,
  CarbonDeviceTable,
  ConfirmDialog,
  PromptDialog,
  OverviewSummary,
  mergeFanMetricSeries,
  TelemetryModelList,
  InstanceFilter,
  InstanceMetricOverride,
  TrafficCalendar,
  TrafficCalendarControls,
  MetricWindowControl,
  metricWindowLabel,
  temperatureStatusLabel,
  temperatureSourceLabel,
  temperatureValueLabel,
  temperatureLimitsLabel,
  TemperatureSourcesPanel,
  AgentTemperatureSourcesPanel,
  LoadingSurface,
  MetricsLoadingSurface,
  SnapshotFreshnessNotice,
  EmptyState,
  ErrorSurface,
  DeviceCard,
  DeviceCardGrid
};
