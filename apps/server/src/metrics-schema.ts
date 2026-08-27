import { z } from "zod";

const MAX_SAFE_METRIC = Number.MAX_SAFE_INTEGER;
const MAX_SAMPLE_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_SAMPLE_FUTURE_MS = 10 * 60 * 1000;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().max(max).optional();
const finite = z.number().finite();
const nonNegative = finite.min(0).max(MAX_SAFE_METRIC);
const nonNegativeInt = z.number().int().min(0).max(MAX_SAFE_METRIC);
const percentage = finite.min(0).max(100);
const temperature = finite.min(-100).max(250).nullable().optional();
const identifier = text(128);
const nullableFinite = finite.nullable().optional();

const timestamp = z.string().trim().min(1).max(64).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "timestamp must be a valid date"
).superRefine((value, context) => {
  const parsed = Date.parse(value);
  const delta = Date.now() - parsed;
  if (delta > MAX_SAMPLE_AGE_MS) {
    context.addIssue({ code: "custom", message: "timestamp is too old" });
  } else if (delta < -MAX_SAMPLE_FUTURE_MS) {
    context.addIssue({ code: "custom", message: "timestamp is too far in the future" });
  }
});

const metricKey = z.enum([
  "cpuUsage",
  "cpuFrequency",
  "cpuTemperature",
  "cpuTopology",
  "systemOverview",
  "gpuUsage",
  "gpuEncode",
  "gpuDecode",
  "gpuFrequency",
  "gpuMemory",
  "gpuTemperature",
  "gpuDriverInfo",
  "temperatureSources",
  "memoryUsage",
  "swapUsage",
  "memoryAvailable",
  "memoryCached",
  "memoryCommitted",
  "memoryHardware",
  "diskUsage",
  "diskRead",
  "diskWrite",
  "diskMetadata",
  "diskActivity",
  "diskHealth",
  "networkRxRate",
  "networkTxRate",
  "networkTraffic",
  "networkIdentity",
  "fanRpm",
  "fanControl",
  "fanTargetTemperature",
  "fanPwm",
  "fanChannelState",
  "fanNote"
]);

const virtualMachineIdentitySchema = z.object({
  vmId: identifier,
  platform: text(64),
  externalId: optionalText(256),
  node: optionalText(128).nullable(),
  type: optionalText(128).nullable(),
  powerState: optionalText(64).nullable(),
  hostDeviceId: optionalText(128),
  hostName: optionalText(255)
}).passthrough();

const identitySchema = z.object({
  deviceId: identifier,
  hostname: text(255),
  os: z.enum(["windows", "linux", "unknown"]),
  platform: text(128),
  arch: text(64),
  cpuModel: optionalText(256),
  version: optionalText(64),
  channel: z.enum(["stable", "test"]).optional(),
  instanceType: z.enum(["device", "virtual_machine"]).optional(),
  hostDeviceId: optionalText(128),
  hostName: optionalText(255),
  virtualMachine: virtualMachineIdentitySchema.optional()
}).passthrough();

const memorySchema = z.object({
  totalBytes: nonNegative,
  usedBytes: nonNegative,
  availableBytes: nonNegative,
  cachedBytes: nonNegative,
  committedBytes: nonNegative,
  commitLimitBytes: nonNegative,
  swapTotalBytes: nonNegative,
  swapUsedBytes: nonNegative,
  speedMHz: nullableFinite,
  slotCount: nonNegativeInt.nullable().optional(),
  formFactor: optionalText(128).nullable()
}).passthrough();

const systemSchema = z.object({
  processCount: nonNegativeInt.max(10_000_000),
  threadCount: nonNegativeInt.max(100_000_000),
  handleCount: nonNegative.max(100_000_000),
  uptimeSeconds: nonNegative.nullable().optional()
}).passthrough();

const smartAttributeSchema = z.object({
  id: nonNegativeInt.max(1_000_000),
  name: text(256),
  value: finite,
  threshold: finite
}).passthrough();

const diskSchema = z.object({
  id: identifier,
  name: text(256),
  mountPoint: text(1_024),
  filesystem: optionalText(128),
  model: optionalText(256),
  vendor: optionalText(256),
  sourceKey: optionalText(256),
  physicalDevice: optionalText(512),
  temperatureC: temperature,
  healthStatus: optionalText(64).nullable(),
  healthReason: optionalText(1_024).nullable(),
  healthPercent: percentage.nullable().optional(),
  smartAttributes: z.array(smartAttributeSchema).max(256).optional(),
  activePercent: percentage.nullable().optional(),
  averageResponseMs: nonNegative.nullable().optional(),
  interfaceType: optionalText(128).nullable(),
  totalBytes: nonNegative,
  usedBytes: nonNegative
}).passthrough();

const cpuPackageSchema = z.object({
  id: identifier,
  name: text(256),
  socketIndex: nonNegativeInt.max(1_024).optional(),
  model: optionalText(256),
  coreCount: nonNegativeInt.max(1_000_000).optional(),
  logicalCount: nonNegativeInt.max(1_000_000).optional(),
  l3CacheBytes: nonNegative.optional(),
  frequencyMHz: nonNegative.nullable().optional(),
  usagePercent: percentage.nullable().optional(),
  temperatureC: temperature
}).passthrough();

const rateSchema = z.object({
  readBytesPerSec: nonNegative,
  writeBytesPerSec: nonNegative,
  activePercent: percentage.optional(),
  averageResponseMs: nonNegative.optional(),
  instances: z.record(identifier, z.object({
    readBytesPerSec: nonNegative,
    writeBytesPerSec: nonNegative,
    activePercent: percentage.optional(),
    averageResponseMs: nonNegative.optional()
  }).passthrough()).refine((value) => Object.keys(value).length <= 2_048, "too many rate instances").optional()
}).passthrough();

const networkRateSchema = z.object({
  rxBytesPerSec: nonNegative,
  txBytesPerSec: nonNegative,
  totalRxBytes: nonNegative,
  totalTxBytes: nonNegative
}).passthrough();

const networkSchema = z.object({
  id: identifier,
  name: text(256),
  model: optionalText(256),
  macAddress: optionalText(64),
  ipv4: z.array(text(64)).max(64).optional(),
  ipv6: z.array(text(128)).max(64).optional(),
  rxBytesPerSec: nonNegative.optional(),
  txBytesPerSec: nonNegative.optional(),
  totalRxBytes: nonNegative.optional(),
  totalTxBytes: nonNegative.optional(),
  linkSpeedMbps: nullableFinite,
  connectionType: optionalText(128).nullable(),
  signalStrengthPercent: percentage.nullable().optional()
}).passthrough();

const gpuSchema = z.object({
  id: identifier,
  name: text(256),
  utilizationPercent: percentage,
  encodeUtilizationPercent: percentage.nullable().optional(),
  decodeUtilizationPercent: percentage.nullable().optional(),
  frequencyMHz: nonNegative.nullable().optional(),
  integrated: z.boolean().optional(),
  memoryKind: z.enum(["dedicated", "shared", "unknown"]).nullable().optional(),
  memoryUsedBytes: nonNegative,
  memoryTotalBytes: nonNegative,
  temperatureC: temperature,
  temperatureSource: optionalText(128).nullable(),
  driverVersion: optionalText(256).nullable()
}).passthrough();

const fanSchema = z.object({
  id: identifier,
  label: text(256),
  interface: text(256),
  rpm: nonNegativeInt.max(1_000_000),
  controlMode: optionalText(128).nullable(),
  targetTemperatureC: temperature,
  minPwmPercent: percentage.nullable().optional(),
  maxPwmPercent: percentage.nullable().optional(),
  channelState: optionalText(128).nullable(),
  note: optionalText(256)
}).passthrough();

const temperatureSensorSchema = z.object({
  id: identifier,
  source: text(256),
  backend: optionalText(128).nullable(),
  hardware: optionalText(256).nullable(),
  hardwareType: optionalText(128).nullable(),
  instanceId: optionalText(256).nullable(),
  path: optionalText(1_024).nullable(),
  rawName: text(256),
  displayName: optionalText(256).nullable(),
  role: z.enum([
    "cpu_package",
    "cpu_core",
    "gpu_core",
    "gpu_hotspot",
    "storage_composite",
    "storage_sensor",
    "motherboard",
    "superio",
    "peci",
    "acpi_zone",
    "threshold",
    "derived",
    "unknown"
  ]),
  currentC: temperature,
  highC: temperature,
  criticalC: temperature,
  emergencyC: temperature,
  alarm: z.boolean().nullable().optional(),
  status: z.enum(["valid", "invalid", "threshold", "unavailable"]),
  confidence: z.enum(["direct", "derived", "unmapped", "diagnostic"]),
  note: optionalText(1_024).nullable()
}).passthrough();

const sensorBackendSchema = z.object({
  id: identifier,
  label: text(256),
  ok: z.boolean(),
  detail: optionalText(1_024)
}).passthrough();

const virtualizationCpuSchema = z.object({
  configuredCores: nonNegativeInt.nullable().optional(),
  usagePercent: percentage.nullable().optional(),
  usageMHz: nonNegative.nullable().optional(),
  demandMHz: nonNegative.nullable().optional(),
  readinessPercent: percentage.nullable().optional()
}).passthrough();

const virtualizationMemorySchema = z.object({
  configuredBytes: nonNegative.nullable().optional(),
  usedBytes: nonNegative.nullable().optional(),
  availableBytes: nonNegative.nullable().optional(),
  activeBytes: nonNegative.nullable().optional(),
  balloonedBytes: nonNegative.nullable().optional(),
  swappedBytes: nonNegative.nullable().optional(),
  pressurePercent: percentage.nullable().optional()
}).passthrough();

const virtualizationDiskSchema = z.object({
  provisionedBytes: nonNegative.nullable().optional(),
  allocatedBytes: nonNegative.nullable().optional(),
  usedBytes: nonNegative.nullable().optional(),
  readBytesPerSec: nonNegative.nullable().optional(),
  writeBytesPerSec: nonNegative.nullable().optional(),
  totalReadBytes: nonNegative.nullable().optional(),
  totalWriteBytes: nonNegative.nullable().optional(),
  readOpsPerSec: nonNegative.nullable().optional(),
  writeOpsPerSec: nonNegative.nullable().optional(),
  latencyMs: nonNegative.nullable().optional()
}).passthrough();

const virtualizationNetworkSchema = z.object({
  rxBytesPerSec: nonNegative.nullable().optional(),
  txBytesPerSec: nonNegative.nullable().optional(),
  totalRxBytes: nonNegative.nullable().optional(),
  totalTxBytes: nonNegative.nullable().optional()
}).passthrough();

const virtualizationDiskDeviceSchema = z.object({
  id: identifier,
  name: text(256),
  storage: optionalText(256).nullable(),
  path: optionalText(1_024).nullable(),
  capacityBytes: nonNegative.nullable().optional(),
  allocatedBytes: nonNegative.nullable().optional(),
  usedBytes: nonNegative.nullable().optional(),
  readBytesPerSec: nonNegative.nullable().optional(),
  writeBytesPerSec: nonNegative.nullable().optional(),
  totalReadBytes: nonNegative.nullable().optional(),
  totalWriteBytes: nonNegative.nullable().optional(),
  latencyMs: nonNegative.nullable().optional()
}).passthrough();

const virtualizationNetworkDeviceSchema = z.object({
  id: identifier,
  name: text(256),
  macAddress: optionalText(64).nullable(),
  bridge: optionalText(256).nullable(),
  switchName: optionalText(256).nullable(),
  network: optionalText(256).nullable(),
  vlan: nonNegativeInt.max(4_094).nullable().optional(),
  rxBytesPerSec: nonNegative.nullable().optional(),
  txBytesPerSec: nonNegative.nullable().optional(),
  totalRxBytes: nonNegative.nullable().optional(),
  totalTxBytes: nonNegative.nullable().optional()
}).passthrough();

const virtualizationFilesystemSchema = z.object({
  mountPoint: text(1_024),
  filesystem: optionalText(128).nullable(),
  totalBytes: nonNegative.nullable().optional(),
  usedBytes: nonNegative.nullable().optional(),
  availableBytes: nonNegative.nullable().optional()
}).passthrough();

const virtualizationGuestSchema = z.object({
  hostname: optionalText(255).nullable(),
  ipv4: z.array(text(64)).max(64).optional(),
  ipv6: z.array(text(128)).max(64).optional(),
  agentAvailable: z.boolean().optional(),
  source: optionalText(128).nullable(),
  filesystems: z.array(virtualizationFilesystemSchema).max(256).optional()
}).passthrough();

const virtualizationStorageSchema = z.object({
  id: identifier,
  name: text(256),
  node: optionalText(128).nullable(),
  type: optionalText(128).nullable(),
  active: z.boolean().nullable().optional(),
  shared: z.boolean().nullable().optional(),
  totalBytes: nonNegative.nullable().optional(),
  usedBytes: nonNegative.nullable().optional(),
  availableBytes: nonNegative.nullable().optional()
}).passthrough();

const virtualizationNodeSchema = z.object({
  id: identifier,
  name: text(256),
  platform: z.enum(["auto", "proxmox", "hyperv", "vsphere", "libvirt", "qemu", "virtualbox", "vmware-workstation", "vmware-fusion"]),
  status: text(128),
  version: optionalText(128).nullable(),
  cpu: virtualizationCpuSchema.optional(),
  memory: virtualizationMemorySchema.optional(),
  disk: virtualizationDiskSchema.optional(),
  network: virtualizationNetworkSchema.optional(),
  storages: z.array(virtualizationStorageSchema).max(2_048).optional()
}).passthrough();

const virtualizationVmSchema = z.object({
  id: identifier,
  name: text(256),
  platform: z.enum(["auto", "proxmox", "hyperv", "vsphere", "libvirt", "qemu", "virtualbox", "vmware-workstation", "vmware-fusion"]),
  node: optionalText(128).nullable(),
  type: optionalText(128).nullable(),
  powerState: text(128),
  cpu: virtualizationCpuSchema.optional(),
  memory: virtualizationMemorySchema.optional(),
  disk: virtualizationDiskSchema.optional(),
  network: virtualizationNetworkSchema.optional(),
  disks: z.array(virtualizationDiskDeviceSchema).max(2_048).optional(),
  networks: z.array(virtualizationNetworkDeviceSchema).max(2_048).optional(),
  guest: virtualizationGuestSchema.optional()
}).passthrough();

const virtualizationIssueSchema = z.object({
  code: text(128),
  message: text(2_048),
  scope: optionalText(256).nullable(),
  retryable: z.boolean().optional()
}).passthrough();

const virtualizationSchema = z.object({
  platform: z.enum(["auto", "proxmox", "hyperv", "vsphere", "libvirt", "qemu", "virtualbox", "vmware-workstation", "vmware-fusion"]),
  source: text(128),
  collectedAt: timestamp,
  inventoryScope: optionalText(256),
  inventoryComplete: z.boolean().optional(),
  nodes: z.array(virtualizationNodeSchema).max(256),
  vms: z.array(virtualizationVmSchema).max(4_096),
  storages: z.array(virtualizationStorageSchema).max(2_048).optional(),
  capabilities: z.array(text(128)).max(256),
  issues: z.array(virtualizationIssueSchema).max(256).optional()
}).passthrough();

export const agentMetricsPayloadSchema = z.object({
  sampleId: optionalText(128),
  identity: identitySchema,
  timestamp,
  heartbeatAt: timestamp,
  unavailableMetrics: z.array(metricKey).max(64).optional(),
  system: systemSchema,
  cpuUsagePercent: percentage,
  cpuFrequencyMHz: nonNegative.nullable().optional(),
  cpuTemperatureC: temperature,
  cpuPackages: z.array(cpuPackageSchema).max(256).optional(),
  memory: memorySchema,
  diskUsage: z.object({
    totalBytes: nonNegative,
    usedBytes: nonNegative
  }).passthrough(),
  disks: z.array(diskSchema).max(2_048).optional(),
  diskRate: rateSchema,
  networkRate: networkRateSchema,
  networkInterfaces: z.array(networkSchema).max(256).optional(),
  gpus: z.array(gpuSchema).max(128),
  fans: z.array(fanSchema).max(256),
  temperatureSensors: z.array(temperatureSensorSchema).max(1_024).optional(),
  sensorBackends: z.array(sensorBackendSchema).max(128).optional(),
  virtualization: virtualizationSchema.nullable().optional()
}).passthrough();
