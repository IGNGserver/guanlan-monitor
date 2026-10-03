import React from "react";
import type { DeviceMetricKey, DeviceSummary } from "@dsc/shared";
import { M3IconButton } from "../m3";
import { Icon, StatusDot } from "../ui";
import { formatDate } from "../formatters";
import { useWorkspace } from "../WorkspaceContext";

export function touchPercent(device: DeviceSummary, key: DeviceMetricKey, value: number | null | undefined): string {
  if (device.unavailableMetrics?.includes(key)) return "不适用";
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "未采集";
}
export function TouchDeviceRow({ device, onMore, selected = false, disabled = false }: {
  device: DeviceSummary; onMore?: () => void; selected?: boolean; disabled?: boolean;
}) {
  const { navigate, snapshot } = useWorkspace();
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
        <span className="touch-device-row__metrics">{online || cached
          ? <>CPU {touchPercent(device, "cpuUsage", device.cpuUsagePercent)}<span>内存 {touchPercent(device, "memoryUsage", device.memoryUsagePercent)}</span></>
          : <>最后在线 {formatDate(device.lastSeenAt)}</>}
        </span>
      </span>
      <span className="touch-device-row__chevron" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>
    </button>
    {onMore && <M3IconButton label={`${device.hostname}的更多操作`} onClick={onMore}><Icon name="more" /></M3IconButton>}
  </div>;
}
