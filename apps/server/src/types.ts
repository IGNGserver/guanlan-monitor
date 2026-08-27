import type {
  AgentIdentity,
  AgentMetricsPayload,
  DeviceBlockKey,
  DeviceMetricKey,
  DeviceDetail,
  DeviceRealtimeEvent,
  DeviceSummary,
  DiskDeviceStats,
  GpuMemoryKind,
  MetricSeries,
  MetricWindow,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import type { VirtualMachineRepository } from "./repositories/virtual-machines.js";

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
  recordedDetails?: {
    system: AgentMetricsPayload["system"];
    memory: AgentMetricsPayload["memory"];
    cpuPackages: AgentMetricsPayload["cpuPackages"];
    disks: AgentMetricsPayload["disks"];
    networkInterfaces: AgentMetricsPayload["networkInterfaces"];
    gpus: AgentMetricsPayload["gpus"];
    fans: AgentMetricsPayload["fans"];
    temperatureSensors: AgentMetricsPayload["temperatureSensors"];
    diskRate: AgentMetricsPayload["diskRate"];
    networkRate: AgentMetricsPayload["networkRate"];
    virtualization: AgentMetricsPayload["virtualization"];
  };
}

export interface InstanceMetricRecord {
  id: string;
  name: string;
  socketIndex?: number;
  interface?: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  coreCount?: number;
  logicalCount?: number;
  l3CacheBytes?: number;
  mountPoint?: string;
  filesystem?: string;
  model?: string;
  vendor?: string;
  physicalDevice?: string;
  interfaceType?: string | null;
  totalBytes?: number;
  usagePercent?: number;
  usedBytes?: number;
  readBytesPerSec?: number;
  writeBytesPerSec?: number;
  activePercent?: number;
  rxBytesPerSec?: number;
  txBytesPerSec?: number;
  trafficRxBytes?: number;
  trafficTxBytes?: number;
  encodePercent?: number;
  decodePercent?: number;
  frequencyMHz?: number;
  memoryUsagePercent?: number;
  memoryUsedBytes?: number;
  integrated?: boolean;
  memoryKind?: GpuMemoryKind | null;
  temperatureC?: number | null;
  healthStatus?: string | null;
  healthReason?: string | null;
  healthPercent?: number | null;
  smartAttributes?: DiskDeviceStats["smartAttributes"];
  temperatureSource?: string | null;
  rpm?: number;
}

export interface DeviceRecord {
  deviceId: string;
  name: string;
  status: "open" | "closed";
  sortOrder: number;
  registeredAt: string;
  updatedAt: string;
}

export interface DeviceRepository {
  init?(): Promise<void>;
  registerOrUpdateDevice(deviceId: string, name?: string): Promise<DeviceRecord>;
  listOpenDevices(): Promise<DeviceRecord[]>;
  deleteDevice(deviceId: string): Promise<void>;
  reorderDevices(deviceIds: string[]): Promise<void>;
}

export interface Repositories {
  realtime: RealtimeRepository;
  history: HistoryRepository;
  devices: DeviceRepository;
  virtualMachines: VirtualMachineRepository;
}

export interface RealtimeRepository {
  upsert(state: DeviceRealtimeState): Promise<void>;
  getDevice(deviceId: string): Promise<DeviceRealtimeState | null>;
  listDevices(): Promise<DeviceRealtimeState[]>;
  remove(deviceId: string): Promise<void>;
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
  runRetentionCleanup?(): Promise<void>;
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
  expiresAt: string;
  credentialVersion: string;
}

export interface FanNoteStore {
  get(deviceId: string): Promise<Record<string, string>>;
  set(deviceId: string, fanId: string, note: string): Promise<void>;
}

export interface DeviceMetricConfigStore {
  get(deviceId: string): Promise<DeviceMetricConfigValue | null>;
  set(deviceId: string, value: DeviceMetricConfigValue): Promise<void>;
}

export interface WidgetLayoutStore {
  init?(): Promise<void>;
  get(scopeKey: string, templateKey: string): Promise<WidgetLayoutSync>;
  save(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync>;
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
  window: MetricWindow;
  rangeStart: string;
  rangeEnd: string;
  series: MetricSeries;
}

export interface DeviceViewerPresencePayload {
  viewerId: string;
  ttlSeconds?: number;
}
