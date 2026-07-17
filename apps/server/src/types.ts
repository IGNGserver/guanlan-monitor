import type {
  AgentIdentity,
  AgentMetricsPayload,
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceDetail,
  DeviceRealtimeEvent,
  DeviceSummary,
  MetricSeries,
  MetricWindow,
  TrafficCalendarMode,
  TrafficCalendarResponse
} from "@dsc/shared";

export interface DeviceRealtimeState {
  identity: AgentIdentity;
  status: "online" | "offline";
  lastSeenAt: string;
  latest: AgentMetricsPayload;
}

export interface TimeSeriesRecord {
  timestamp: number;
  cpuUsagePercent: number;
  cpuFrequencyMHz: number;
  cpuTemperatureC: number;
  gpuUsagePercent: number;
  gpuEncodePercent: number;
  gpuDecodePercent: number;
  gpuFrequencyMHz: number;
  gpuMemoryUsagePercent: number;
  gpuTemperatureC: number;
  memoryUsagePercent: number;
  swapUsagePercent: number;
  memoryUsedBytes: number;
  swapUsedBytes: number;
  diskUsagePercent: number;
  diskUsedBytes: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  trafficRxBytes: number;
  trafficTxBytes: number;
  cpus?: InstanceMetricRecord[];
  disks?: InstanceMetricRecord[];
  networks?: InstanceMetricRecord[];
  gpus?: InstanceMetricRecord[];
  fans?: InstanceMetricRecord[];
}

export interface InstanceMetricRecord {
  id: string;
  name: string;
  interface?: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  coreCount?: number;
  logicalCount?: number;
  mountPoint?: string;
  filesystem?: string;
  model?: string;
  vendor?: string;
  usagePercent?: number;
  usedBytes?: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
  rxBytesPerSec?: number;
  txBytesPerSec?: number;
  trafficRxBytes?: number;
  trafficTxBytes?: number;
  encodePercent?: number;
  decodePercent?: number;
  frequencyMHz?: number;
  memoryUsagePercent?: number;
  memoryUsedBytes?: number;
  temperatureC?: number;
  rpm?: number;
}

export interface Repositories {
  realtime: RealtimeRepository;
  history: HistoryRepository;
}

export interface RealtimeRepository {
  upsert(state: DeviceRealtimeState): Promise<void>;
  getDevice(deviceId: string): Promise<DeviceRealtimeState | null>;
  listDevices(): Promise<DeviceRealtimeState[]>;
  appendSeries(deviceId: string, bucket: MetricWindow, point: TimeSeriesRecord, maxPoints: number): Promise<void>;
  readSeries(deviceId: string, bucket: MetricWindow): Promise<TimeSeriesRecord[]>;
  clearSeries(deviceId: string): Promise<void>;
}

export interface HistoryRepository {
  insertMinutePoint(deviceId: string, point: TimeSeriesRecord): Promise<void>;
  insertHourlyPoint(deviceId: string, point: TimeSeriesRecord): Promise<void>;
  getHistoricalSeries(deviceId: string, bucket: MetricWindow): Promise<TimeSeriesRecord[]>;
  clearDeviceHistory(deviceId: string): Promise<void>;
  getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse>;
  listKnownDevices(): Promise<Array<{ deviceId: string; lastSeenAt: string }>>;
}

export interface DeviceQueryResult {
  summary: DeviceSummary;
  detail: DeviceDetail;
  latest: AgentMetricsPayload;
}

export type DeviceEventEmitter = (event: DeviceRealtimeEvent) => void;

export interface AggregatedWindowConfig {
  bucket: MetricWindow;
  maxPoints: number;
}

export interface SessionValue {
  issuedAt: string;
}

export interface FanNoteStore {
  get(deviceId: string): Promise<Record<string, string>>;
  set(deviceId: string, fanId: string, note: string): Promise<void>;
}

export interface DeviceMetricConfigStore {
  get(deviceId: string): Promise<DeviceMetricConfigValue | null>;
  set(deviceId: string, value: DeviceMetricConfigValue): Promise<void>;
}

export interface DeviceMetricConfigValue {
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
}

export interface MetricAccumulator {
  bucketStartedAt: number;
  samples: TimeSeriesRecord[];
}

export interface ServerContext {
  repositories: Repositories;
  emitDeviceEvent: DeviceEventEmitter;
}

export interface MetricsResponse {
  device: DeviceDetail;
  status: DeviceSummary["status"];
  lastSeenAt: string | null;
  series: MetricSeries;
}

export interface DeviceViewerPresencePayload {
  viewerId: string;
  ttlSeconds?: number;
}
