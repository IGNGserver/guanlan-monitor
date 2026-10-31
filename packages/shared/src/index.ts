export type MetricWindow =
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "6h"
  | "24h"
  | "1d"
  | "7d"
  | "1w"
  | "30d"
  | "1mo"
  | "90d"
  | "1y";

export type DeviceStatus = "online" | "offline";

export type ReleaseChannel = "stable" | "test";

export type UpdatePlatform =
  | "hub"
  | "web"
  | "windows-gui"
  | "linux-gui"
  | "macos-gui"
  | "android"
  | "ios";

export type DeviceBlockKey = "cpu" | "gpu" | "memory" | "disk" | "network" | "fan";

export type GpuMemoryKind = "dedicated" | "shared" | "unified" | "unknown";

export type AgentProbeTarget = DeviceBlockKey | "connection";

export type AgentProbeProvider =
  | "builtin"
  | "gopsutil"
  | "darwin"
  | "hwmon"
  | "wmi"
  | "librehardwaremonitor"
  | "libreHardwareMonitor"
  | "openHardwareMonitor"
  | "redfish"
  | "disabled";

export type DeviceMetricKey =
  | "cpuUsage"
  | "cpuFrequency"
  | "cpuTemperature"
  | "cpuTopology"
  | "systemOverview"
  | "gpuUsage"
  | "gpuEncode"
  | "gpuDecode"
  | "gpuFrequency"
  | "gpuMemory"
  | "gpuTemperature"
  | "gpuDriverInfo"
  | "temperatureSources"
  | "memoryUsage"
  | "swapUsage"
  | "memoryAvailable"
  | "memoryCached"
  | "memoryCommitted"
  | "memoryHardware"
  | "diskUsage"
  | "diskRead"
  | "diskWrite"
  | "diskMetadata"
  | "diskActivity"
  | "diskHealth"
  | "storagePools"
  | "networkRxRate"
  | "networkTxRate"
  | "networkTraffic"
  | "networkIdentity"
  | "fanRpm"
  | "fanControl"
  | "fanTargetTemperature"
  | "fanPwm"
  | "fanChannelState"
  | "fanNote";

export interface AgentIdentity {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux" | "macos" | "unknown";
  platform: string;
  arch: string;
  cpuModel?: string;
  version?: string;
  channel?: ReleaseChannel;
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
  physicalDevice?: string;
  temperatureC?: number | null;
  healthStatus?: string | null;
  healthReason?: string | null;
  healthPercent?: number | null;
  smartAttributes?: DiskSmartAttribute[];
  activePercent?: number | null;
  averageResponseMs?: number | null;
  interfaceType?: string | null;
  totalBytes: number;
  usedBytes: number;
}

export interface DiskSmartAttribute {
  id: number;
  name: string;
  value: number;
  threshold: number;
}

/**
 * What kind of host storage entity a pool is. The kinds come from the
 * collectors: Proxmox storage types, LVM/ZFS topology, and mounted filesystem
 * families.
 */
export type StoragePoolKind =
  | "lvmthin"
  | "lvm"
  | "zfs"
  | "btrfs"
  | "dir"
  | "nfs"
  | "cifs"
  | "pbs"
  | "filesystem"
  | "unknown";

/**
 * One host storage entity that can hold virtual machine disks: a Proxmox
 * storage, an LVM thin pool or volume, a ZFS pool, or a mounted filesystem
 * including network shares. Deliberately separate from `DiskDeviceStats`: a
 * pool has no mount point, and its `usedBytes` can mean thin-provisioned
 * allocation rather than filesystem usage.
 */
export interface StoragePoolStats {
  id: string;
  name: string;
  kind: StoragePoolKind;
  /** Which collector observed the entity: proxmox | mount | lvm | zfs. */
  source?: string;
  node?: string;
  mountPoint?: string;
  device?: string;
  volumeGroup?: string;
  thinPool?: string;
  physicalDevices?: string[];
  /** Proxmox content types (images, rootdir, backup, iso, ...). */
  content?: string[];
  active?: boolean | null;
  enabled?: boolean | null;
  shared?: boolean | null;
  totalBytes: number;
  usedBytes: number;
  availableBytes?: number | null;
  /** Thin pool allocation percentage (data), when the source exposes it. */
  dataPercent?: number | null;
  /** Thin pool metadata percentage, when the source exposes it. */
  metadataPercent?: number | null;
  health?: string | null;
}

/** One storage pool's history. */
export interface StoragePoolMetricSeries {
  id: string;
  name: string;
  kind: StoragePoolKind;
  node?: string;
  mountPoint?: string;
  active: boolean;
  shared: boolean;
  totalBytes: SamplePoint[];
  usedBytes: SamplePoint[];
  availableBytes: SamplePoint[];
  usagePercent: SamplePoint[];
}

export interface MemoryStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  cachedBytes: number;
  committedBytes: number;
  commitLimitBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  speedMHz?: number | null;
  slotCount?: number | null;
  formFactor?: string | null;
  /** Darwin: physical memory held by the compressor (already inside usedBytes). */
  compressedBytes?: number;
  /** Kernel memory-pressure level where the platform publishes one (macOS). */
  pressureLevel?: MemoryPressureLevel;
  /** Module technology, e.g. DDR4 or LPDDR5. */
  memoryType?: string;
}

export type MemoryPressureLevel = "normal" | "warning" | "critical";

export interface SystemStats {
  processCount: number;
  threadCount: number;
  handleCount: number;
  uptimeSeconds?: number | null;
}

export interface CpuPackageStats {
  id: string;
  name: string;
  socketIndex?: number;
  model?: string;
  coreCount?: number;
  logicalCount?: number;
  l3CacheBytes?: number | null;
  frequencyMHz?: number | null;
  usagePercent?: number | null;
  temperatureC?: number | null;
  l2CacheBytes?: number | null;
  /** Heterogeneous core clusters (Apple performance/efficiency levels). */
  clusters?: CpuClusterStats[];
}

export interface CpuClusterStats {
  name: string;
  coreCount: number;
  logicalCount?: number;
  l2CacheBytes?: number;
  l3CacheBytes?: number;
  frequencyMHz?: number | null;
}

export interface RateStats {
  readBytesPerSec: number;
  writeBytesPerSec: number;
  activePercent?: number;
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
  model?: string;
  macAddress?: string;
  ipv4?: string[];
  ipv6?: string[];
  rxBytesPerSec?: number;
  txBytesPerSec?: number;
  totalRxBytes?: number;
  totalTxBytes?: number;
  linkSpeedMbps?: number | null;
  connectionType?: string | null;
  signalStrengthPercent?: number | null;
  rssiDbm?: number | null;
  noiseDbm?: number | null;
}

/** Average power over the collector's last hardware window; absent fields had no source. */
export interface PowerStats {
  observedAt: string;
  source: string;
  systemWatts?: number;
  inputWatts?: number;
  cpuWatts?: number;
  gpuWatts?: number;
  aneWatts?: number;
  dramWatts?: number;
  mediaWatts?: number;
  adapterRatedWatts?: number;
  externalPower?: boolean;
}

export interface BatteryStats {
  observedAt: string;
  source: string;
  chargePercent?: number;
  healthPercent?: number;
  cycleCount?: number;
  designCapacityMAh?: number;
  fullChargeCapacityMAh?: number;
  temperatureC?: number;
  voltageV?: number;
  /** Signed: positive while charging, negative while discharging. */
  amperageMA?: number;
  netPowerWatts?: number;
  timeRemainingMinutes?: number;
  charging?: boolean;
  externalPower?: boolean;
  fullyCharged?: boolean;
  condition?: string;
}

export type ThermalPressureLevel = "nominal" | "moderate" | "heavy" | "trapping" | "sleeping";

export interface ThermalStats {
  observedAt: string;
  source: string;
  pressureLevel: ThermalPressureLevel;
}

export interface GpuDeviceStats {
  id: string;
  name: string;
  utilizationPercent: number;
  encodeUtilizationPercent?: number | null;
  decodeUtilizationPercent?: number | null;
  frequencyMHz?: number | null;
  integrated?: boolean;
  memoryKind?: GpuMemoryKind | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  temperatureC?: number | null;
  temperatureSource?: string | null;
  driverVersion?: string | null;
}

export type TemperatureSensorRole =
  | "cpu_package"
  | "cpu_core"
  | "gpu_core"
  | "gpu_hotspot"
  | "storage_composite"
  | "storage_sensor"
  | "motherboard"
  | "superio"
  | "peci"
  | "acpi_zone"
  | "threshold"
  | "derived"
  | "unknown";

export type TemperatureSensorStatus = "valid" | "invalid" | "threshold" | "unavailable";

export type TemperatureSensorConfidence = "direct" | "derived" | "unmapped" | "diagnostic";

export interface TemperatureSensorReading {
  id: string;
  source: string;
  backend?: string | null;
  hardware?: string | null;
  hardwareType?: string | null;
  instanceId?: string | null;
  path?: string | null;
  rawName: string;
  displayName?: string | null;
  role: TemperatureSensorRole;
  currentC?: number | null;
  observedAt?: string | null;
  highC?: number | null;
  criticalC?: number | null;
  emergencyC?: number | null;
  alarm?: boolean | null;
  status: TemperatureSensorStatus;
  confidence: TemperatureSensorConfidence;
  note?: string | null;
}

export interface FanSensorStats {
  id: string;
  label: string;
  interface: string;
  rpm: number;
  rpmStatus?: "observed" | "disabled" | "unavailable";
  controlMode?: string | null;
  targetTemperatureC?: number | null;
  minPwmPercent?: number | null;
  maxPwmPercent?: number | null;
  channelState?: string | null;
  note?: string;
}

export interface SensorBackendStatus {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface DeviceMetricOption {
  key: DeviceMetricKey;
  available: boolean;
}

export interface DeviceMetricConfigPayload {
  /** Omit the field for the legacy default of all metrics; [] explicitly disables all metrics. */
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
}

export interface AgentConnectionConfig {
  serverUrl: string;
  secret: string;
  deviceId: string;
  hostname: string;
}

export interface AgentSamplingConfig {
  normalIntervalSeconds: number;
  slowIntervalSeconds: number;
}

export interface AgentProbeSelection {
  target: AgentProbeTarget;
  provider: AgentProbeProvider;
  enabled: boolean;
}

export interface AgentLocalConfig extends DeviceMetricConfigPayload {
  configVersion?: number;
  connection: AgentConnectionConfig;
  sampling: AgentSamplingConfig;
  probeSelections: AgentProbeSelection[];
  cloudSyncEnabled?: boolean;
  dataRecordingEnabled?: boolean;
  autoRestartCollector?: boolean;
  autoStartCollector?: boolean;
}

export interface AgentCloudConfigSyncPayload extends DeviceMetricConfigPayload {
  deviceId: string;
}

export interface DeviceMetricConfigResponse {
  deviceId: string;
  availableMetrics: DeviceMetricOption[];
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
}

export interface AgentMetricsPayload {
  sampleId?: string;
  identity: AgentIdentity;
  timestamp: string;
  heartbeatAt: string;
  hardwareSampledAt?: string;
  cpuTemperatureSampledAt?: string;
  /** Metrics that the collector knows are unavailable, kept separate from real zero values. */
  unavailableMetrics?: DeviceMetricKey[];
  metricQuality?: Partial<Record<DeviceMetricKey, MetricQuality>>;
  system: SystemStats;
  cpuUsagePercent: number;
  cpuFrequencyMHz?: number | null;
  cpuTemperatureC?: number | null;
  cpuPackages?: CpuPackageStats[];
  memory: MemoryStats;
  diskUsage: StorageUsage;
  disks?: DiskDeviceStats[];
  storagePools?: StoragePoolStats[];
  diskRate: DiskRateStats;
  networkRate: NetworkTrafficStats;
  networkInterfaces?: NetworkInterfaceStats[];
  gpus: GpuDeviceStats[];
  fans: FanSensorStats[];
  temperatureSensors?: TemperatureSensorReading[];
  sensorBackends?: SensorBackendStatus[];
  /**
   * External probe processes the collector started during this sample, keyed by
   * executable name. Additive and optional: it exists so the collector's own
   * process churn is observable from the metrics history instead of only from a
   * process monitor on the reporting machine.
   */
  probeSpawns?: Record<string, number>;
  /** Cumulative self-observed slow-collection cost. Optional and additive. */
  collectorStats?: CollectorStatsReport;
  /** Optional observations outside the metric whitelist; omitted when the machine has no source. */
  power?: PowerStats;
  battery?: BatteryStats;
  thermal?: ThermalStats;
}

export interface MetricQuality {
  state: "direct" | "derived" | "unavailable" | "not_applicable" | "stale";
  source?: string;
  reason?: string;
  observedAt?: string;
}

export interface CollectorStatsReport {
  slowRuns: number;
  slowOverruns: number;
  lastSlowMillis: number;
}

export interface DeviceSummary {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux" | "macos" | "unknown";
  agentVersion: string | null;
  agentChannel: ReleaseChannel | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  cpuUsagePercent: number | null;
  gpuUsagePercent: number | null;
  gpuMemoryUsagePercent: number | null;
  memoryUsagePercent: number | null;
  memoryUsedBytes?: number | null;
  memoryTotalBytes?: number | null;
  diskUsagePercent: number | null;
  diskUsedBytes?: number | null;
  diskTotalBytes?: number | null;
  sortOrder?: number;
  /** User-defined group name; null or omitted means ungrouped. */
  group?: string | null;
  /** Metrics that are not meaningful for the current instance state. */
  unavailableMetrics?: DeviceMetricKey[];
}

export interface DeviceReorderPayload {
  deviceIds: string[];
}

export interface DeviceGroupUpdatePayload {
  deviceIds: string[];
  group: string | null;
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
  physicalDevice?: string;
  totalBytes: SamplePoint[];
  usagePercent: SamplePoint[];
  activePercent: SamplePoint[];
  usedBytes: SamplePoint[];
  readBytesPerSec: SamplePoint[];
  writeBytesPerSec: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface GpuMetricSeries {
  id: string;
  name: string;
  integrated?: boolean;
  memoryKind?: GpuMemoryKind | null;
  usagePercent: SamplePoint[];
  encodePercent: SamplePoint[];
  decodePercent: SamplePoint[];
  frequencyMHz: SamplePoint[];
  memoryUsagePercent: SamplePoint[];
  memoryUsedBytes: SamplePoint[];
  temperatureC: SamplePoint[];
  temperatureSource?: string | null;
}

export interface FanMetricSeries {
  id: string;
  name: string;
  interface: string;
  rpm: SamplePoint[];
}

export interface TemperatureMetricSeries {
  id: string;
  name: string;
  rawName: string;
  source: string;
  backend?: string | null;
  hardware?: string | null;
  role: TemperatureSensorRole;
  confidence: TemperatureSensorConfidence;
  status: TemperatureSensorStatus;
  currentC: SamplePoint[];
  highC?: number | null;
  criticalC?: number | null;
  emergencyC?: number | null;
}

export interface CpuMetricSeries {
  id: string;
  name: string;
  socketIndex?: number;
  model?: string;
  coreCount?: number;
  logicalCount?: number;
  l3CacheBytes?: number | null;
  usagePercent: SamplePoint[];
  frequencyMHz: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface NetworkMetricSeries {
  id: string;
  name: string;
  model?: string;
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
  gpuMemoryUsedBytes: SamplePoint[];
  gpuTemperatureC: SamplePoint[];
  memoryUsagePercent: SamplePoint[];
  swapUsagePercent: SamplePoint[];
  memoryUsedBytes: SamplePoint[];
  swapUsedBytes: SamplePoint[];
  memoryAvailableBytes: SamplePoint[];
  memoryCachedBytes: SamplePoint[];
  memoryCommittedBytes: SamplePoint[];
  memoryCommitLimitBytes: SamplePoint[];
  systemProcessCount: SamplePoint[];
  systemThreadCount: SamplePoint[];
  systemHandleCount: SamplePoint[];
  diskUsagePercent: SamplePoint[];
  diskUsedBytes: SamplePoint[];
  diskReadBytesPerSec: SamplePoint[];
  diskWriteBytesPerSec: SamplePoint[];
  networkRxBytesPerSec: SamplePoint[];
  networkTxBytesPerSec: SamplePoint[];
  trafficRxBytes: SamplePoint[];
  trafficTxBytes: SamplePoint[];
  cpus: CpuMetricSeries[];
  disks: DiskMetricSeries[];
  storagePools: StoragePoolMetricSeries[];
  networks: NetworkMetricSeries[];
  gpus: GpuMetricSeries[];
  fans: FanMetricSeries[];
  temperatureSensors: TemperatureMetricSeries[];
}

export interface UpdateInfo {
  currentVersion: string;
  currentChannel: ReleaseChannel;
  platform: UpdatePlatform;
  arch?: string;
  available: boolean;
  latestVersion: string | null;
  latestChannel: ReleaseChannel | null;
  releaseTag: string | null;
  releaseUrl: string | null;
  notesUrl: string | null;
  publishedAt: string | null;
  assetName: string | null;
  assetUrl: string | null;
  assetSize: number | null;
  sha256: string | null;
  installMode: "installer" | "package" | "apk" | "hub" | "store" | "none";
  message?: string;
}

export interface SystemVersionInfo {
  version: string;
  channel: ReleaseChannel;
  repository: string;
}

export interface HubUpdateRequest {
  version: string;
}

export interface HubUpdateStatus {
  state: "idle" | "requested" | "failed";
  requestedVersion: string | null;
  requestedAt: string | null;
  message: string | null;
}

export interface MetricsLatest {
  hardwareSampledAt?: string | null;
  cpuTemperatureSampledAt?: string | null;
  system: SystemStats;
  cpuUsagePercent: number;
  cpuFrequencyMHz: number | null;
  cpuTemperatureC: number | null;
  cpuPackages: CpuPackageStats[];
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  memoryCachedBytes: number;
  memoryCommittedBytes: number;
  memoryCommitLimitBytes: number;
  memorySpeedMHz: number | null;
  memorySlotCount: number | null;
  memoryFormFactor: string | null;
  memoryType?: string | null;
  memoryCompressedBytes?: number | null;
  memoryPressureLevel?: MemoryPressureLevel | null;
  power?: PowerStats | null;
  battery?: BatteryStats | null;
  thermal?: ThermalStats | null;
  swapUsedBytes: number;
  swapTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  disks: DiskDeviceStats[];
  storagePools: StoragePoolStats[];
  networkInterfaces: NetworkInterfaceStats[];
  gpus: GpuDeviceStats[];
  temperatureSensors: TemperatureSensorReading[];
  sensorBackends: SensorBackendStatus[];
  fans: FanSensorStats[];
  unavailableMetrics?: DeviceMetricKey[];
}

export interface MetricsResponse {
  sampling?: { method: "minmax-v1"; targetPoints: number };
  device: DeviceDetail;
  status: DeviceStatus;
  lastSeenAt: string | null;
  window: MetricWindow;
  rangeStart: string;
  rangeEnd: string;
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig: Record<string, DeviceMetricKey[]>;
  availableMetrics: DeviceMetricOption[];
  latest: MetricsLatest;
  series: MetricSeries;
}

/** One instance's overview chart series: each overview line is one instance. */
export interface OverviewInstanceSeries {
  deviceId: string;
  hostname: string;
  cpuUsagePercent: SamplePoint[];
  memoryUsedBytes: SamplePoint[];
  diskUsedBytes: SamplePoint[];
  networkRxBytesPerSec: SamplePoint[];
  networkTxBytesPerSec: SamplePoint[];
  unavailableMetrics?: DeviceMetricKey[];
}

/** All-instance metrics for the overview page charts. */
export interface OverviewMetricsResponse {
  sampling?: { method: "minmax-v1"; targetPoints: number };
  window: MetricWindow;
  instances: OverviewInstanceSeries[];
}

/** The local Agent backend contract after the main process removes secrets. */
export interface DesktopAgentConfig {
  configVersion: number;
  connection: Omit<AgentConnectionConfig, "secret"> & {
    secretConfigured: boolean;
  };
  sampling: AgentSamplingConfig;
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig: Record<string, DeviceMetricKey[]>;
  probeSelections: AgentProbeSelection[];
  cloudSyncEnabled: boolean;
  dataRecordingEnabled: boolean;
  autoRestartCollector: boolean;
  autoStartCollector: boolean;
}

export interface DesktopProbePlan {
  target: AgentProbeTarget;
  providers: string[];
  default: string;
}

export interface DesktopDetectedTarget {
  id: string;
  name: string;
  subtitle?: string;
  enabled: boolean;
  metrics: string[];
}

export interface DesktopDetectedTargetGroup {
  target: AgentProbeTarget;
  label: string;
  instances: DesktopDetectedTarget[];
}

/**
 * How the desktop shell reaches the local agent data plane.
 *
 * - `service`: attached to the machine-scope service with full control access.
 * - `service-readonly`: attached to the service but this user may not change
 *   machine-scope settings; the payload carries no secret and no probe data.
 * - `child`: the desktop shell owns a private backend process (portable mode).
 */
export type DesktopAgentMode = "service" | "service-readonly" | "child";

export interface DesktopAgentBackendState {
  running: boolean;
  backendStartedAt: string;
  frontendParentPid: number;
  childStartedAt?: string;
  connectionStatus: string;
  lastChildLog?: string;
  lastUploadAt?: string;
  lastCloudSyncAt?: string;
  lastCloudSyncError?: string;
  cloudConfigPending: boolean;
  lastDetectAt?: string;
  lastExitAt?: string;
  lastRestartAt?: string;
  restartCount: number;
  lastExitCode?: number | null;
  autoRestartPending: boolean;
  effectiveUploadIntervalSeconds: number;
  lastIssueCategory?: string;
  lastIssueDetail?: string;
  lastIssueAt?: string;
  lastIssueCount: number;
  lastIssueRecoveredAt?: string;
  configPath: string;
  configFileExists: boolean;
  syncStatePath: string;
  syncStateFileExists: boolean;
  diagnosticsPath: string;
  diagnosticsFileExists: boolean;
  pendingStatePath: string;
  pendingStateFileExists: boolean;
  pendingSampleCount: number;
  pendingBytes: number;
  oldestPendingAt?: string;
  lastUploadError?: string;
  config: DesktopAgentConfig;
  supportedProbePlans: DesktopProbePlan[];
  detectedTargets: DesktopDetectedTargetGroup[];
  temperatureSources: TemperatureSensorReading[];
  temperatureSensorBackends: SensorBackendStatus[];
  temperatureProbeError?: string;
  /** Additive: how this state was obtained. Absent on older payloads. */
  agentMode?: DesktopAgentMode;
}

/**
 * Snapshot state shared by the browser console and the Electron renderer.
 *
 * `Desktop*` aliases below are retained for the IPC and cache contracts while
 * the presentation layer moves to platform-neutral terminology.
 */
export type ConsoleSnapshotSource = "live" | "cache" | "empty";
export type DesktopSnapshotSource = ConsoleSnapshotSource;

export interface ConsoleCacheState {
  available: boolean;
  savedAt: string | null;
  ageSeconds: number | null;
}
export type DesktopCacheState = ConsoleCacheState;

export interface ConsoleSessionState {
  authenticated: boolean;
  accessKeyConfigured: boolean;
}
export type DesktopSessionState = ConsoleSessionState;

export interface ConsoleSnapshot {
  generatedAt: string;
  source: ConsoleSnapshotSource;
  cache: ConsoleCacheState;
  session: ConsoleSessionState;
  localBackend: DesktopAgentBackendState | null;
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  metrics: MetricsResponse | null;
  overviewMetrics: OverviewMetricsResponse | null;
  trafficCalendar: TrafficCalendarResponse | null;
  update: UpdateInfo | null;
  startup: DesktopStartupSettings;
}
export type DesktopSnapshot = ConsoleSnapshot;

export interface DesktopStartupSettings {
  updateChannel?: "stable" | "preview";
  openAtLogin: boolean;
  startMinimized: boolean;
}

/**
 * Which optional resources the current view actually reads. A shell may skip
 * the rest and carry their last values forward. Omitted means "everything",
 * so a transport that predates the hint keeps working unchanged.
 */
export interface ConsoleSnapshotInclude {
  /** The selected device's telemetry history (device page). */
  deviceMetrics?: boolean;
  /** One series per device for the overview trend. */
  overviewMetrics?: boolean;
  /** The selected device's traffic calendar (device page). */
  trafficCalendar?: boolean;
}

export interface ConsoleSnapshotRequest {
  networkMode?: "auto" | "standard" | "saver";
  metricWindow?: MetricWindow;
  selectedDeviceId?: string | null;
  trafficMode?: TrafficCalendarMode;
  trafficAnchor?: string;
  preferCache?: boolean;
  include?: ConsoleSnapshotInclude;
  /**
   * A periodic refresh nobody asked for. The transport may lean on what it
   * confirmed recently (the session, slow resources); a user refresh, a
   * navigation or a reconnect never sets it and always re-confirms.
   */
  background?: boolean;
}
export type DesktopSnapshotRequest = ConsoleSnapshotRequest;

export type DesktopAgentControlAction = "start" | "stop" | "restart" | "check-connection" | "detect-probes";

export interface DesktopConfigPatch {
  configVersion?: number;
  connection?: Partial<Omit<AgentConnectionConfig, "secret">>;
  sampling?: Partial<AgentSamplingConfig>;
  enabledMetrics?: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
  probeSelections?: AgentProbeSelection[];
  cloudSyncEnabled?: boolean;
  dataRecordingEnabled?: boolean;
  autoRestartCollector?: boolean;
  autoStartCollector?: boolean;
}

export type DesktopMemoryPressure = "normal" | "elevated" | "critical";

export interface DesktopRuntimeProfile {
  isRemoteSession: boolean;
  memoryPressure: DesktopMemoryPressure;
  recommendedRefreshInterval: 5 | 10 | 30;
  chartPointLimit: number;
  useOpaqueWindow: boolean;
}

export interface DesktopRendererBridge {
  readonly live?: import("./live.js").ConsoleLivePort;
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  cancelSnapshot?(): Promise<void>;
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot>;
  login(accessKey: string): Promise<DesktopSnapshot>;
  logout(): Promise<DesktopSnapshot>;
  disconnectAgent(): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  deleteInstance(deviceId: string): Promise<DesktopSnapshot>;
  reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot>;
  updateDeviceGroup(deviceIds: string[], group: string | null): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  openExternal(url: string): Promise<void>;
  getRuntimeProfile(): Promise<DesktopRuntimeProfile>;
  getWindowState(): Promise<DesktopWindowState>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowDragStart(screenX: number, screenY: number): void;
  windowDragMove(screenX: number, screenY: number): void;
  windowDragEnd(): void;
  windowClose(): Promise<void>;
  exit(): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
  subscribeWindowState(listener: (state: DesktopWindowState) => void): () => void;
}

export interface DesktopWindowState {
  maximized: boolean;
  fullscreen: boolean;
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
  /** The Hub removed this instance from its live inventory. */
  removed?: boolean;
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
export type { LiveTopic, LiveConnection, LiveMetrics, LiveProcess, LiveProcesses, LiveContainer, LiveDocker, LiveDataMap, LiveSnapshot, ConsoleLivePort } from "./live.js";
