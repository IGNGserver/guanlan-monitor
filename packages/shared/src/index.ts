export type MetricWindow = "1m" | "15m" | "1d" | "1w" | "1mo" | "1y";

export type DeviceStatus = "online" | "offline";

export type DeviceBlockKey = "cpu" | "gpu" | "memory" | "disk" | "network" | "fan";

export type DeviceMetricKey =
  | "cpuUsage"
  | "cpuFrequency"
  | "cpuTemperature"
  | "gpuUsage"
  | "gpuEncode"
  | "gpuDecode"
  | "gpuFrequency"
  | "gpuMemory"
  | "gpuTemperature"
  | "memoryUsage"
  | "swapUsage"
  | "diskUsage"
  | "diskRead"
  | "diskWrite"
  | "networkRxRate"
  | "networkTxRate"
  | "networkTraffic";

export interface AgentIdentity {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux";
  platform: string;
  arch: string;
  cpuModel?: string;
}

export interface SamplePoint {
  timestamp: string;
  value: number;
}

export interface ThroughputPoint {
  timestamp: string;
  rx: number;
  tx: number;
}

export interface StorageUsage {
  totalBytes: number;
  usedBytes: number;
}

export interface DiskDeviceStats {
  id: string;
  name: string;
  mountPoint: string;
  filesystem?: string;
  model?: string;
  vendor?: string;
  sourceKey?: string;
  totalBytes: number;
  usedBytes: number;
}

export interface MemoryStats {
  totalBytes: number;
  usedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface CpuPackageStats {
  id: string;
  name: string;
  model?: string;
  coreCount?: number;
  logicalCount?: number;
  frequencyMHz?: number | null;
  usagePercent?: number | null;
  temperatureC?: number | null;
}

export interface RateStats {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface DiskRateStats extends RateStats {
  instances?: Record<string, RateStats>;
}

export interface NetworkTrafficStats {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  totalRxBytes: number;
  totalTxBytes: number;
}

export interface NetworkInterfaceStats {
  id: string;
  name: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  rxBytesPerSec?: number;
  txBytesPerSec?: number;
  totalRxBytes?: number;
  totalTxBytes?: number;
}

export interface GpuDeviceStats {
  id: string;
  name: string;
  utilizationPercent: number;
  encodeUtilizationPercent?: number | null;
  decodeUtilizationPercent?: number | null;
  frequencyMHz?: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  temperatureC?: number | null;
}

export interface FanSensorStats {
  id: string;
  label: string;
  interface: string;
  rpm: number;
  note?: string;
}

export interface DeviceMetricOption {
  key: DeviceMetricKey;
  available: boolean;
}

export interface DeviceMetricConfigPayload {
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
}

export interface DeviceMetricConfigResponse {
  deviceId: string;
  availableMetrics: DeviceMetricOption[];
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
}

export interface AgentMetricsPayload {
  identity: AgentIdentity;
  timestamp: string;
  heartbeatAt: string;
  cpuUsagePercent: number;
  cpuFrequencyMHz?: number | null;
  cpuTemperatureC?: number | null;
  cpuPackages?: CpuPackageStats[];
  memory: MemoryStats;
  diskUsage: StorageUsage;
  disks?: DiskDeviceStats[];
  diskRate: DiskRateStats;
  networkRate: NetworkTrafficStats;
  networkInterfaces?: NetworkInterfaceStats[];
  gpus: GpuDeviceStats[];
  fans: FanSensorStats[];
}

export interface DeviceSummary {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux";
  status: DeviceStatus;
  lastSeenAt: string | null;
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  diskUsagePercent: number | null;
}

export interface DeviceDetail extends DeviceSummary {
  platform: string;
  arch: string;
  cpuModel?: string;
}

export interface DiskMetricSeries {
  id: string;
  name: string;
  mountPoint: string;
  filesystem?: string;
  model?: string;
  vendor?: string;
  usagePercent: SamplePoint[];
  readBytesPerSec: SamplePoint[];
  writeBytesPerSec: SamplePoint[];
}

export interface GpuMetricSeries {
  id: string;
  name: string;
  usagePercent: SamplePoint[];
  encodePercent: SamplePoint[];
  decodePercent: SamplePoint[];
  frequencyMHz: SamplePoint[];
  memoryUsagePercent: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface CpuMetricSeries {
  id: string;
  name: string;
  model?: string;
  coreCount?: number;
  logicalCount?: number;
  usagePercent: SamplePoint[];
  frequencyMHz: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface NetworkMetricSeries {
  id: string;
  name: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  rxBytesPerSec: SamplePoint[];
  txBytesPerSec: SamplePoint[];
  trafficRxBytes: SamplePoint[];
  trafficTxBytes: SamplePoint[];
}

export interface MetricSeries {
  cpuUsagePercent: SamplePoint[];
  cpuFrequencyMHz: SamplePoint[];
  cpuTemperatureC: SamplePoint[];
  gpuUsagePercent: SamplePoint[];
  gpuEncodePercent: SamplePoint[];
  gpuDecodePercent: SamplePoint[];
  gpuFrequencyMHz: SamplePoint[];
  gpuMemoryUsagePercent: SamplePoint[];
  gpuTemperatureC: SamplePoint[];
  memoryUsagePercent: SamplePoint[];
  swapUsagePercent: SamplePoint[];
  diskUsagePercent: SamplePoint[];
  diskReadBytesPerSec: SamplePoint[];
  diskWriteBytesPerSec: SamplePoint[];
  networkRxBytesPerSec: SamplePoint[];
  networkTxBytesPerSec: SamplePoint[];
  trafficRxBytes: SamplePoint[];
  trafficTxBytes: SamplePoint[];
  cpus: CpuMetricSeries[];
  disks: DiskMetricSeries[];
  networks: NetworkMetricSeries[];
  gpus: GpuMetricSeries[];
}

export interface AuthLoginPayload {
  accessKey: string;
}

export interface AuthLoginResponse {
  ok: true;
}

export interface DeviceRealtimeEvent {
  deviceId: string;
  summary: DeviceSummary;
  latest: AgentMetricsPayload;
}

export type TrafficCalendarMode = "day" | "week" | "month";

export interface TrafficCalendarCell {
  key: string;
  label: string;
  rangeStart: string;
  rangeEnd: string;
  totalRxBytes: number;
  totalTxBytes: number;
  isSelected: boolean;
  isCurrentPeriod: boolean;
  isInPrimaryScope: boolean;
}

export interface TrafficRangeRecord {
  timestamp: string;
  rxBytes: number;
  txBytes: number;
  totalBytes: number;
}

export interface TrafficCalendarResponse {
  mode: TrafficCalendarMode;
  anchor: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  cells: TrafficCalendarCell[];
  records: TrafficRangeRecord[];
  totalRxBytes: number;
  totalTxBytes: number;
}

export interface FanNotePayload {
  note: string;
}
