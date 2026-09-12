import type { ConsoleSnapshot, DeviceMetricKey, DeviceSummary, InstanceType } from "@dsc/shared";

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
  instanceType?: InstanceType | "all";
  status?: DeviceDirectoryStatus;
  sort?: DeviceDirectorySort;
}

function metricUnavailable(device: DeviceSummary, key: DeviceMetricKey): boolean {
  return (device.unavailableMetrics ?? []).includes(key);
}

export function selectHealthSummary(snapshot: ConsoleSnapshot, devices: DeviceSummary[], formatDate: (value: string | null | undefined) => string): HealthSummary {
  const online = devices.filter((device) => device.status === "online").length;
  const source = snapshot.source === "cache"
    ? "cache"
    : snapshot.source === "live" && snapshot.session.authenticated
      ? "live"
      : snapshot.source === "empty"
        ? "empty"
        : "unknown";
  const pending = source === "live"
    ? devices.length - online + (snapshot.localBackend?.lastIssueCount ?? 0) + (devices.length === 0 ? 1 : 0)
    : null;
  return {
    total: devices.length,
    online,
    offline: devices.length - online,
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

export function selectDeviceDirectory(devices: DeviceSummary[], query: DeviceDirectoryQuery = {}): DeviceSummary[] {
  const normalizedQuery = query.query?.trim().toLocaleLowerCase() ?? "";
  const filtered = devices.filter((device) => {
    const typeMatches = !query.instanceType || query.instanceType === "all" || (device.instanceType ?? "device") === query.instanceType;
    const statusMatches = !query.status || query.status === "all" || (query.status === "online" ? device.status === "online" : device.status !== "online");
    const textMatches = !normalizedQuery || `${device.hostname} ${device.deviceId} ${device.os} ${device.hostName ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
    return typeMatches && statusMatches && textMatches;
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
