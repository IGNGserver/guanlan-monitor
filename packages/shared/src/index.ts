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

export type InstanceType = "device" | "virtual_machine";

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

export type GpuMemoryKind = "dedicated" | "shared" | "unknown";

export type AgentProbeTarget = DeviceBlockKey | "connection";

export type AgentProbeProvider =
  | "builtin"
  | "gopsutil"
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
  os: "windows" | "linux" | "unknown";
  platform: string;
  arch: string;
  cpuModel?: string;
  version?: string;
  channel?: ReleaseChannel;
  instanceType?: InstanceType;
  hostDeviceId?: string;
  hostName?: string;
  virtualMachine?: VirtualMachineIdentity;
}

export interface VirtualMachineIdentity {
  vmId: string;
  platform: AgentVirtualizationPlatform | string;
  externalId?: string;
  node?: string | null;
  type?: string | null;
  powerState?: string | null;
  hostDeviceId?: string;
  hostName?: string;
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
}

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

export type AgentVirtualizationPlatform =
  | "auto"
  | "proxmox"
  | "hyperv"
  | "vsphere"
  | "libvirt"
  | "qemu"
  | "virtualbox"
  | "vmware-workstation"
  | "vmware-fusion";

export interface AgentVirtualizationConfig {
  enabled: boolean;
  platform: AgentVirtualizationPlatform;
  endpoint?: string;
  node?: string;
  insecureSkipTlsVerify?: boolean;
  pollIntervalSeconds?: number;
}

export interface VirtualizationCpuStats {
  configuredCores?: number | null;
  usagePercent?: number | null;
  usageMHz?: number | null;
  demandMHz?: number | null;
  readinessPercent?: number | null;
}

export interface VirtualizationMemoryStats {
  configuredBytes?: number | null;
  usedBytes?: number | null;
  availableBytes?: number | null;
  activeBytes?: number | null;
  balloonedBytes?: number | null;
  swappedBytes?: number | null;
  pressurePercent?: number | null;
}

export interface VirtualizationDiskStats {
  provisionedBytes?: number | null;
  allocatedBytes?: number | null;
  usedBytes?: number | null;
  readBytesPerSec?: number | null;
  writeBytesPerSec?: number | null;
  totalReadBytes?: number | null;
  totalWriteBytes?: number | null;
  readOpsPerSec?: number | null;
  writeOpsPerSec?: number | null;
  latencyMs?: number | null;
}

export interface VirtualizationNetworkStats {
  rxBytesPerSec?: number | null;
  txBytesPerSec?: number | null;
  totalRxBytes?: number | null;
  totalTxBytes?: number | null;
}

export interface VirtualizationDiskDevice {
  id: string;
  name: string;
  storage?: string | null;
  path?: string | null;
  capacityBytes?: number | null;
  allocatedBytes?: number | null;
  usedBytes?: number | null;
  readBytesPerSec?: number | null;
  writeBytesPerSec?: number | null;
  totalReadBytes?: number | null;
  totalWriteBytes?: number | null;
  latencyMs?: number | null;
}

export interface VirtualizationNetworkDevice {
  id: string;
  name: string;
  macAddress?: string | null;
  bridge?: string | null;
  switchName?: string | null;
  network?: string | null;
  vlan?: number | null;
  rxBytesPerSec?: number | null;
  txBytesPerSec?: number | null;
  totalRxBytes?: number | null;
  totalTxBytes?: number | null;
}

export interface VirtualizationFilesystemDevice {
  mountPoint: string;
  filesystem?: string | null;
  totalBytes?: number | null;
  usedBytes?: number | null;
  availableBytes?: number | null;
}

export interface VirtualizationGuestInfo {
  hostname?: string | null;
  ipv4?: string[];
  ipv6?: string[];
  agentAvailable?: boolean;
  source?: string | null;
  filesystems?: VirtualizationFilesystemDevice[];
}

export interface VirtualizationStorageTelemetry {
  id: string;
  name: string;
  /** Cluster node that owns this storage pool. The device scope already identifies the cluster. */
  node?: string | null;
  type?: string | null;
  active?: boolean | null;
  shared?: boolean | null;
  totalBytes?: number | null;
  usedBytes?: number | null;
  availableBytes?: number | null;
}

export interface VirtualizationNodeTelemetry {
  id: string;
  name: string;
  platform: AgentVirtualizationPlatform;
  status: string;
  version?: string | null;
  cpu?: VirtualizationCpuStats;
  memory?: VirtualizationMemoryStats;
  disk?: VirtualizationDiskStats;
  network?: VirtualizationNetworkStats;
  storages?: VirtualizationStorageTelemetry[];
}

export interface VirtualMachineTelemetry {
  id: string;
  name: string;
  platform: AgentVirtualizationPlatform;
  node?: string | null;
  type?: string | null;
  powerState: string;
  cpu?: VirtualizationCpuStats;
  memory?: VirtualizationMemoryStats;
  disk?: VirtualizationDiskStats;
  network?: VirtualizationNetworkStats;
  disks?: VirtualizationDiskDevice[];
  networks?: VirtualizationNetworkDevice[];
  guest?: VirtualizationGuestInfo;
}

export interface VirtualizationIssue {
  code: string;
  message: string;
  scope?: string | null;
  retryable?: boolean;
}

export interface VirtualizationSnapshot {
  platform: AgentVirtualizationPlatform;
  source: string;
  collectedAt: string;
  nodes: VirtualizationNodeTelemetry[];
  vms: VirtualMachineTelemetry[];
  storages?: VirtualizationStorageTelemetry[];
  capabilities: string[];
  issues?: VirtualizationIssue[];
}

export function virtualizationStorageInstanceId(node: string | null | undefined, storageId: string): string {
  return node ? `${node}:${storageId}` : storageId;
}

function hasVirtualizationStorageCapacity(
  storage: Pick<VirtualizationStorageTelemetry, "totalBytes" | "usedBytes" | "availableBytes">
): boolean {
  return [storage.totalBytes, storage.usedBytes, storage.availableBytes].some((value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
  );
}

export function isDisplayableVirtualizationStorage(
  storage: Pick<VirtualizationStorageTelemetry, "active" | "totalBytes" | "usedBytes" | "availableBytes">
): boolean {
  // Proxmox returns cluster-wide storage configuration for every node. A pool
  // that is inactive on this node, or has no capacity values, is not a
  // node-local telemetry instance and should not become a misleading card.
  return storage.active !== false && hasVirtualizationStorageCapacity(storage);
}

export function isDisplayableVirtualizationStorageSeries(
  storage: Pick<VirtualizationStorageMetricSeries, "active" | "totalBytes" | "usedBytes" | "availableBytes">
): boolean {
  // Historical series use arrays rather than the latest snapshot's scalar
  // capacity values. Keep the same node-local and real-capacity policy for
  // legacy data already stored by the Hub.
  return storage.active !== false && [storage.totalBytes, storage.usedBytes, storage.availableBytes].some((points) =>
    points.some((point) => typeof point.value === "number" && Number.isFinite(point.value) && point.value > 0)
  );
}

/**
 * Return one stable, node-scoped record for every usable virtualization
 * storage pool. Node records are authoritative; the legacy top-level list is
 * only a fallback.
 */
export function virtualizationStorageInstances(snapshot: VirtualizationSnapshot | null | undefined): VirtualizationStorageTelemetry[] {
  if (!snapshot) return [];
  const nodeStorages = snapshot.nodes.flatMap((node) =>
    (node.storages ?? []).map((storage) => ({
      ...storage,
      id: virtualizationStorageInstanceId(node.id, storage.id),
      node: node.id
    }))
  ).filter(isDisplayableVirtualizationStorage);
  if (nodeStorages.length) return nodeStorages;
  return (snapshot.storages ?? []).map((storage) => ({
    ...storage,
    id: virtualizationStorageInstanceId(storage.node, storage.id)
  })).filter(isDisplayableVirtualizationStorage);
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
  virtualization?: AgentVirtualizationConfig;
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
  /** Metrics that the collector knows are unavailable, kept separate from real zero values. */
  unavailableMetrics?: DeviceMetricKey[];
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
  temperatureSensors?: TemperatureSensorReading[];
  sensorBackends?: SensorBackendStatus[];
  virtualization?: VirtualizationSnapshot | null;
}

export interface DeviceSummary {
  deviceId: string;
  hostname: string;
  os: "windows" | "linux" | "unknown";
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
  instanceType?: InstanceType;
  hostName?: string | null;
  virtualMachine?: VirtualMachineIdentity | null;
  /** Metrics that are not meaningful for the current instance state. */
  unavailableMetrics?: DeviceMetricKey[];
}

export interface DeviceReorderPayload {
  deviceIds: string[];
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

export interface VirtualizationStorageMetricSeries {
  id: string;
  name: string;
  node?: string | null;
  type?: string | null;
  active?: boolean | null;
  shared?: boolean | null;
  totalBytes: SamplePoint[];
  usedBytes: SamplePoint[];
  availableBytes: SamplePoint[];
  usagePercent: SamplePoint[];
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
  networks: NetworkMetricSeries[];
  gpus: GpuMetricSeries[];
  fans: FanMetricSeries[];
  temperatureSensors: TemperatureMetricSeries[];
  /** Virtualization storage pools are separate from mounted filesystem disks. */
  storagePools?: VirtualizationStorageMetricSeries[];
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
  memoryCommitLimitBytes: number;
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
  temperatureSensors: TemperatureSensorReading[];
  sensorBackends: SensorBackendStatus[];
  fans: FanSensorStats[];
  virtualization?: VirtualizationSnapshot | null;
  /** Current virtualization storage pools, normalized to stable node-scoped IDs. */
  storagePools?: VirtualizationStorageTelemetry[];
  unavailableMetrics?: DeviceMetricKey[];
}

export interface MetricsResponse {
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
  instanceType: InstanceType;
  cpuUsagePercent: SamplePoint[];
  memoryUsedBytes: SamplePoint[];
  diskUsedBytes: SamplePoint[];
  networkRxBytesPerSec: SamplePoint[];
  networkTxBytesPerSec: SamplePoint[];
  unavailableMetrics?: DeviceMetricKey[];
}

/** All-instance metrics for the overview page charts. */
export interface OverviewMetricsResponse {
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
  virtualization?: AgentVirtualizationConfig;
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
  temperatureSources: TemperatureSensorReading[];
  temperatureSensorBackends: SensorBackendStatus[];
  temperatureProbeError?: string;
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
  openAtLogin: boolean;
  startMinimized: boolean;
}

export interface ConsoleSnapshotRequest {
  metricWindow?: MetricWindow;
  selectedDeviceId?: string | null;
  trafficMode?: TrafficCalendarMode;
  trafficAnchor?: string;
  preferCache?: boolean;
}
export type DesktopSnapshotRequest = ConsoleSnapshotRequest;

export type WidgetLayoutSize = "large" | "medium" | "small";
export type WidgetLayoutKind = "group" | "content";
export type WidgetVisualization = "line" | "area" | "bar" | "donut" | "number" | "table";
export type WidgetPanelKind = "system" | "custom";

export interface WidgetPanelMetadata {
  id: string;
  name: string;
  kind: WidgetPanelKind;
  order: number;
}

export type WidgetConfigValue = string | number | boolean | null;

export interface WidgetInstanceConfig {
  visualization?: WidgetVisualization;
  metric?: string;
  targetId?: string | null;
  [key: string]: WidgetConfigValue | undefined;
}

export interface WidgetLayoutPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  size: WidgetLayoutSize;
  hidden?: boolean;
}

export interface WidgetLayoutCatalogEntry {
  title: string;
  kind: WidgetLayoutKind;
  defaultSize: WidgetLayoutSize;
  templateId?: string;
  groupId?: string;
  widgetType?: string;
  category?: string;
  visualization?: WidgetVisualization;
  config?: WidgetInstanceConfig;
}

export interface WidgetLayoutDocument {
  version?: number;
  placements: Record<string, WidgetLayoutPlacement>;
  catalog: Record<string, WidgetLayoutCatalogEntry>;
  snapToGrid: boolean;
  panels?: WidgetPanelMetadata[];
}

export interface WidgetLayoutTemplate {
  id: string;
  name: string;
  templateKey: string;
  createdAt: string;
  updatedAt: string;
  layout: WidgetLayoutDocument;
}

export interface WidgetLayoutSync {
  scopeKey: string;
  templateKey: string;
  instanceLayout: WidgetLayoutDocument | null;
  templates: WidgetLayoutTemplate[];
}

export interface WidgetLayoutRequest {
  scopeKey: string;
  templateKey: string;
}

export interface WidgetLayoutSaveRequest {
  scopeKey: string;
  templateKey: string;
  instanceLayout?: WidgetLayoutDocument | null;
  template?: {
    id?: string;
    name: string;
    layout: WidgetLayoutDocument;
  };
  deleteTemplateId?: string;
}

export type DesktopAgentControlAction = "start" | "stop" | "restart" | "check-connection" | "detect-probes";

export interface DesktopConfigPatch {
  configVersion?: number;
  connection?: Partial<Omit<AgentConnectionConfig, "secret">>;
  sampling?: Partial<AgentSamplingConfig>;
  enabledMetrics?: DeviceMetricKey[];
  enabledDeviceIds?: Partial<Record<DeviceBlockKey, string[]>>;
  instanceMetricConfig?: Record<string, DeviceMetricKey[]>;
  probeSelections?: AgentProbeSelection[];
  virtualization?: AgentVirtualizationConfig;
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
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot>;
  setAgentSecret(secret: string): Promise<DesktopSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot>;
  login(accessKey: string): Promise<DesktopSnapshot>;
  logout(): Promise<DesktopSnapshot>;
  disconnectAgent(): Promise<DesktopSnapshot>;
  cloudPush(): Promise<DesktopSnapshot>;
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync>;
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  deleteInstance(deviceId: string): Promise<DesktopSnapshot>;
  reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  openExternal(url: string): Promise<void>;
  getRuntimeProfile(): Promise<DesktopRuntimeProfile>;
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<boolean>;
  windowDragStart(screenX: number, screenY: number): void;
  windowDragMove(screenX: number, screenY: number): void;
  windowDragEnd(): void;
  windowClose(): Promise<void>;
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
