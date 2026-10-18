import React from "react";
import type { DeviceMetricKey, DeviceSummary } from "@dsc/shared";
import { M3IconButton } from "../m3";
import { Icon, StatusDot } from "../ui";
import { CapacityBar } from "../charts";
import { formatDate } from "../formatters";
import { useWorkspace } from "../WorkspaceContext";
import { metricSeverity, metricTone, metricValue, type ThresholdMetric } from "../health";

export function touchPercent(device: DeviceSummary, key: DeviceMetricKey, value: number | null | undefined): string {
  if (device.unavailableMetrics?.includes(key)) return "不适用";
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "未采集";
}
export function TouchDeviceRow({ device, onMore, selected = false, disabled = false }: {
  device: DeviceSummary; onMore?: () => void; selected?: boolean; disabled?: boolean;
}) {
  const { navigate, snapshot, healthThresholds } = useWorkspace();
  // Same thresholds as the overview, so a row and the attention list agree.
  const tone = (metric: ThresholdMetric) => {
    const severity = device.status === "online" ? metricSeverity(metricValue(device, metric), healthThresholds[metric]) : null;
    return severity ? `guanlan-metric guanlan-metric--${severity}` : undefined;
  };
  const cached = snapshot?.source === "cache";
  const online = device.status === "online";
  return <div className={`touch-device-row${selected ? " is-selected" : ""}`}>
    <button type="button" className="touch-device-row__open" data-device-id={device.deviceId} disabled={disabled} aria-current={selected ? "page" : undefined}
      onClick={() => navigate({ kind: "device", deviceId: device.deviceId })}>
      <span className={`touch-device-row__icon${!online ? " is-offline" : ""}`}><Icon name="device" size={22} /></span>
      <span className="touch-device-row__copy"><strong>{device.hostname}</strong>
        <span className="touch-device-row__state"><StatusDot state={cached ? "cached" : online ? "online" : "offline"} />
          {cached ? `缓存中${online ? "在线" : "离线"}` : online ? "在线" : "离线"} · {device.os}
        </span>
        <span className={`touch-device-row__metrics${online || cached ? "" : " is-note"}`}>{online || cached
          ? ([["cpu", "CPU", "cpuUsage", device.cpuUsagePercent], ["memory", "内存", "memoryUsage", device.memoryUsagePercent], ["disk", "磁盘", "diskUsage", device.diskUsagePercent]] as const).map(([metric, label, key, value]) => <span className="touch-device-row__metric" key={metric}>
            <span className={tone(metric)}>{label} {touchPercent(device, key, value)}</span>
            <CapacityBar percent={device.unavailableMetrics?.includes(key) ? null : metricValue(device, metric)} tone={online ? metricTone(metricValue(device, metric), healthThresholds[metric]) : "normal"} size="sm" />
          </span>)
          : <>最后在线 {formatDate(device.lastSeenAt)}</>}
        </span>
      </span>
      <span className="touch-device-row__chevron" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>
    </button>
    {onMore && <M3IconButton label={`${device.hostname}的更多操作`} onClick={onMore}><Icon name="more" /></M3IconButton>}
  </div>;
}
