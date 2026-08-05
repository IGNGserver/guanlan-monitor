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
  | "android"
  | "ios"
  | "windows-cli"
  | "linux-cli";

export type DeviceBlockKey = "cpu" | "gpu" | "memory" | "disk" | "network" | "fan";

export type AgentProbeTarget = DeviceBlockKey | "connection";

export type AgentProbeProvider =
  | "builtin"
  | "wmi"
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
  os: "windows" | "linux";
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

export interface MemoryStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  cachedBytes: number;
  committedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  speedMHz?: number | null;
  slotCount?: number | null;
  formFactor?: string | null;
}

export interface SystemStats {
  processCount: number;
  threadCount: number;
  handleCount: number;
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
  driverVersion?: string | null;
}

export interface FanSensorStats {
  id: string;
  label: string;
  interface: string;
  rpm: number;
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
  connection: AgentConnectionConfig;
  sampling: AgentSamplingConfig;
  probeSelections: AgentProbeSelection[];
  cloudSyncEnabled?: boolean;
  autoRestartCollector?: boolean;
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
  system: SystemStats;
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
  sensorBackends?: SensorBackendStatus[];
}

export interface DeviceSummary {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux";
  agentVersion: string | null;
  agentChannel: ReleaseChannel | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  cpuUsagePercent: number | null;
  gpuUsagePercent: number | null;
  gpuMemoryUsagePercent: number | null;
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
  activePercent: SamplePoint[];
  usedBytes: SamplePoint[];
  readBytesPerSec: SamplePoint[];
  writeBytesPerSec: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface GpuMetricSeries {
  id: string;
  name: string;
  usagePercent: SamplePoint[];
  encodePercent: SamplePoint[];
  decodePercent: SamplePoint[];
  frequencyMHz: SamplePoint[];
  memoryUsagePercent: SamplePoint[];
  memoryUsedBytes: SamplePoint[];
  temperatureC: SamplePoint[];
}

export interface FanMetricSeries {
  id: string;
  name: string;
  interface: string;
  rpm: SamplePoint[];
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
  memoryUsedBytes: SamplePoint[];
  swapUsedBytes: SamplePoint[];
  memoryAvailableBytes: SamplePoint[];
  memoryCachedBytes: SamplePoint[];
  memoryCommittedBytes: SamplePoint[];
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
  networks: NetworkMetricSeries[];
  gpus: GpuMetricSeries[];
  fans: FanMetricSeries[];
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
  installMode: "installer" | "package" | "apk" | "cli" | "hub" | "store" | "none";
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
  memorySpeedMHz: number | null;
  memorySlotCount: number | null;
  memoryFormFactor: string | null;
  swapUsedBytes: number;
  swapTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  disks: DiskDeviceStats[];
  networkInterfaces: NetworkInterfaceStats[];
  gpus: GpuDeviceStats[];
  sensorBackends: SensorBackendStatus[];
  fans: FanSensorStats[];
}

export interface MetricsResponse {
  device: DeviceDetail;
  status: DeviceStatus;
  lastSeenAt: string | null;
  enabledMetrics: DeviceMetricKey[];
  enabledDeviceIds: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig: Record<string, DeviceMetricKey[]>;
  availableMetrics: DeviceMetricOption[];
  latest: MetricsLatest;
  series: MetricSeries;
}

/** The local Agent backend contract after the main process removes secrets. */
export interface DesktopAgentConfig {
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
}

export type DesktopSnapshotSource = "live" | "cache" | "empty";

export interface DesktopCacheState {
  available: boolean;
  savedAt: string | null;
  ageSeconds: number | null;
}

export interface DesktopSessionState {
  authenticated: boolean;
  accessKeyConfigured: boolean;
}

export interface DesktopSnapshot {
  generatedAt: string;
  source: DesktopSnapshotSource;
  cache: DesktopCacheState;
  session: DesktopSessionState;
  localBackend: DesktopAgentBackendState | null;
  devices: DeviceSummary[];
  selectedDeviceId: string | null;
  metrics: MetricsResponse | null;
  trafficCalendar: TrafficCalendarResponse | null;
  update: UpdateInfo | null;
  startup: DesktopStartupSettings;
}

export interface DesktopStartupSettings {
  openAtLogin: boolean;
  startMinimized: boolean;
}

export interface DesktopSnapshotRequest {
  metricWindow?: MetricWindow;
  selectedDeviceId?: string | null;
  trafficMode?: TrafficCalendarMode;
  trafficAnchor?: string;
  preferCache?: boolean;
}

export type DesktopAgentControlAction = "start" | "stop" | "check-connection" | "detect-probes";

export interface DesktopConfigPatch {
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

export interface DesktopRendererBridge {
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot>;
  setAgentSecret(secret: string): Promise<DesktopSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot>;
  login(accessKey: string): Promise<DesktopSnapshot>;
  logout(): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  openExternal(url: string): Promise<void>;
  exit(): Promise<void>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
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
