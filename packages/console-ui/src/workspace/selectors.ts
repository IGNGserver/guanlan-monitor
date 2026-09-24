import type { ConsoleSnapshot, DeviceMetricKey, DeviceSummary } from "@dsc/shared";

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
  if (snapshot.source === "empty") return "empty";
  return "unknown";
}

function metricUnavailable(device: DeviceSummary, key: DeviceMetricKey): boolean {
  return (device.unavailableMetrics ?? []).includes(key);
}

export function selectHealthSummary(snapshot: ConsoleSnapshot, allDevices: DeviceSummary[], formatDate: (value: string | null | undefined) => string): HealthSummary {
  const online = allDevices.filter((device) => device.status === "online").length;
  const source = selectSnapshotSource(snapshot, allDevices);
  const unhealthyDevices = allDevices.filter((device) => device.status !== "online").length;
  const pending = source === "live"
    ? unhealthyDevices + (snapshot.localBackend?.lastIssueCount ?? 0)
    : null;
  return {
    total: allDevices.length,
    online,
    offline: allDevices.length - online,
    pending,
    source,
    sourceLabel: source === "live" ? "实时连接" : source === "cache" ? "离线缓存" : source === "empty" ? "等待数据" : "连接异常",
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

export function selectOverviewDevices(allDevices: DeviceSummary[], limit = 6): DeviceSummary[] {
  return allDevices
    .slice()
    .sort((left, right) => (left.status === "online" ? 1 : 0) - (right.status === "online" ? 1 : 0)
      || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      || Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? ""))
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
    if (sort === "lastSeen") return Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? "");
    return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  });
}
