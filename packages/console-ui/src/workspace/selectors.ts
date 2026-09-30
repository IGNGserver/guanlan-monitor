import type { ConsoleSnapshot, DeviceMetricKey, DeviceSummary } from "@dsc/shared";
import { dateValueOf } from "./sampleTime.ts";

export type DeviceDirectoryStatus = "all" | "online" | "offline";
export type DeviceDirectorySort = "order" | "name" | "cpu" | "memory" | "lastSeen";

export interface HealthSummary {
  total: number;
  online: number;
  offline: number;
  pending: number | null;
  source: "live" | "cache" | "empty" | "unknown";
  sourceLabel: string;
  sourceDetail: string;
}
export interface DeviceDirectoryQuery {
  query?: string;
  status?: DeviceDirectoryStatus;
  sort?: DeviceDirectorySort;
}

export type SnapshotDataSource = HealthSummary["source"];

/**
 * Keep source/auth/data semantics in one selector so the shell, overview,
 * settings and hub pages cannot disagree about an authenticated empty state.
 */
export function selectSnapshotSource(snapshot: ConsoleSnapshot, allDevices: DeviceSummary[] = snapshot.devices): SnapshotDataSource {
  if (snapshot.source === "cache") return "cache";
  const hasData = allDevices.length > 0 || (snapshot.overviewMetrics?.instances.length ?? 0) > 0;
  if (snapshot.source === "live" && snapshot.session.authenticated) return hasData ? "live" : "empty";
  // "empty" must mean exactly one thing: an authenticated hub that simply has no
  // devices yet. A snapshot carrying `source: "empty"` *without* a session is the
  // adapter's expired-session reset (see `markSessionExpired`), which is a
  // connection fault and belongs to "unknown". Collapsing the two made the shell
  // report a working first run as 未连接 / 连接异常 — and, once the overview
  // treated "empty" as a clean zero, would have reported a dead session as fine.
  if (snapshot.source === "empty" && snapshot.session.authenticated) return "empty";
  return "unknown";
}

function metricUnavailable(device: DeviceSummary, key: DeviceMetricKey): boolean {
  return (device.unavailableMetrics ?? []).includes(key);
}

export type LiveDataTransport = ConsoleSnapshot["source"] extends never ? never : "push" | "poll";

/**
 * One place names the live data link for both clients.
 *
 * The overview used to say "实时连接" while the device page and the connection
 * card said "实时中枢" for the same fact, and both said "实时" even on the
 * desktop shell, which polls. The transport is a capability, so the wording is
 * derived from it rather than restated per page.
 */
export function liveLinkLabel(transport: LiveDataTransport): string {
  return transport === "push" ? "实时连接" : "定时刷新";
}

export function selectLinkLabel(source: SnapshotDataSource, transport: LiveDataTransport): string {
  if (source === "live") return liveLinkLabel(transport);
  if (source === "cache") return "离线缓存";
  if (source === "empty") return "等待数据";
  return "连接异常";
}

/**
 * Whether the fleet needs attention, and how many items that is.
 *
 * `null` means "cannot be determined" — a cached or unauthenticated snapshot.
 * An authenticated hub with no devices yet is a determinate zero: there is
 * nothing to attend to, and answering "连接异常" under a page that says
 * 等待设备接入 counted a working first run as a fault.
 */
function selectAttentionCount(snapshot: ConsoleSnapshot, unhealthyDevices: number, source: SnapshotDataSource): number | null {
  if (source !== "live" && source !== "empty") return null;
  return unhealthyDevices + (snapshot.localBackend?.lastIssueCount ?? 0);
}

export function selectHealthSummary(snapshot: ConsoleSnapshot, allDevices: DeviceSummary[], formatDate: (value: string | null | undefined) => string, transport: LiveDataTransport = "push"): HealthSummary {
  const online = allDevices.filter((device) => device.status === "online").length;
  const source = selectSnapshotSource(snapshot, allDevices);
  const unhealthyDevices = allDevices.filter((device) => device.status !== "online").length;
  const pending = selectAttentionCount(snapshot, unhealthyDevices, source);
  return {
    total: allDevices.length,
    online,
    offline: allDevices.length - online,
    pending,
    source,
    sourceLabel: selectLinkLabel(source, transport),
    sourceDetail: source === "cache"
      ? `缓存于 ${formatDate(snapshot.cache.savedAt)}`
      : source === "empty"
        ? "尚未取得设备快照"
        : `同步于 ${formatDate(snapshot.generatedAt)}`
  };
}

export function selectResourceRanking(devices: DeviceSummary[], metric: "cpu" | "memory" | "disk", limit = 5): DeviceSummary[] {
  const key: DeviceMetricKey = metric === "cpu" ? "cpuUsage" : metric === "memory" ? "memoryUsage" : "diskUsage";
  const value = (device: DeviceSummary) => metric === "cpu"
    ? device.cpuUsagePercent
    : metric === "memory"
      ? device.memoryUsagePercent
      : device.diskUsagePercent;
  return devices
    .filter((device) => device.status === "online" && Number.isFinite(value(device)) && !metricUnavailable(device, key))
    .slice()
    .sort((left, right) => (value(right) ?? 0) - (value(left) ?? 0))
    .slice(0, limit);
}

/**
 * Devices the overview should surface.
 *
 * The overview used to show "重点实例" while actually listing the first six
 * devices in any state, which duplicated the device directory one click away.
 * It now surfaces only what cannot answer for itself, so a healthy fleet leaves
 * nothing to read here and the directory keeps its role as the device list.
 */
export function selectAttentionDevices(allDevices: DeviceSummary[], limit = 6): DeviceSummary[] {
  return allDevices
    .filter((device) => device.status !== "online")
    .slice()
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      || dateValueOf(left.lastSeenAt ?? "") - dateValueOf(right.lastSeenAt ?? ""))
    .slice(0, limit);
}


export function selectDeviceDirectory(devices: DeviceSummary[], query: DeviceDirectoryQuery = {}): DeviceSummary[] {
  const normalizedQuery = query.query?.trim().toLocaleLowerCase() ?? "";
  const filtered = devices.filter((device) => {
    const statusMatches = !query.status || query.status === "all" || (query.status === "online" ? device.status === "online" : device.status !== "online");
    const textMatches = !normalizedQuery || `${device.hostname} ${device.deviceId} ${device.os}`.toLocaleLowerCase().includes(normalizedQuery);
    return statusMatches && textMatches;
  });
  const sort = query.sort ?? "order";
  return filtered.slice().sort((left, right) => {
    if (sort === "name") return left.hostname.localeCompare(right.hostname, "zh-CN");
    if (sort === "cpu") return (right.cpuUsagePercent ?? -1) - (left.cpuUsagePercent ?? -1);
    if (sort === "memory") return (right.memoryUsagePercent ?? -1) - (left.memoryUsagePercent ?? -1);
    if (sort === "lastSeen") return dateValueOf(right.lastSeenAt ?? "") - dateValueOf(left.lastSeenAt ?? "");
    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
}
