import { z } from "zod";
import type { AgentIdentity, AgentMetricsPayload } from "@dsc/shared";

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
  "storagePools",
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

const identitySchema = z.object({
  deviceId: identifier,
  hostname: text(255),
  os: z.enum(["windows", "linux", "macos", "unknown"]),
  platform: text(128),
  arch: text(64),
  cpuModel: optionalText(256),
  version: optionalText(64),
  channel: z.enum(["stable", "test"]).optional()
}).passthrough().transform((identity): AgentIdentity => {
  const sanitized = { ...identity } as Record<string, unknown>;
  delete sanitized.instanceType;
  delete sanitized.hostDeviceId;
  delete sanitized.hostName;
  delete sanitized.virtualMachine;
  delete sanitized.virtualization;
  return sanitized as unknown as AgentIdentity;
});

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
  formFactor: optionalText(128).nullable(),
  compressedBytes: nonNegative.optional(),
  pressureLevel: z.enum(["normal", "warning", "critical"]).optional(),
  memoryType: optionalText(64)
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
  temperatureC: temperature,
  l2CacheBytes: nonNegative.nullable().optional(),
  clusters: z.array(z.object({
    name: text(64),
    coreCount: nonNegativeInt.max(1_000_000),
    logicalCount: nonNegativeInt.max(1_000_000).optional(),
    l2CacheBytes: nonNegative.optional(),
    l3CacheBytes: nonNegative.optional(),
    frequencyMHz: nonNegative.nullable().optional()
  }).passthrough()).max(16).optional()
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
  signalStrengthPercent: percentage.nullable().optional(),
  rssiDbm: finite.min(-150).max(0).nullable().optional(),
  noiseDbm: finite.min(-150).max(0).nullable().optional()
}).passthrough();

const gpuSchema = z.object({
  id: identifier,
  name: text(256),
  utilizationPercent: percentage,
  encodeUtilizationPercent: percentage.nullable().optional(),
  decodeUtilizationPercent: percentage.nullable().optional(),
  frequencyMHz: nonNegative.nullable().optional(),
  integrated: z.boolean().optional(),
  memoryKind: z.enum(["dedicated", "shared", "unified", "unknown"]).nullable().optional(),
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
  rpmStatus: z.enum(["observed", "disabled", "unavailable"]).optional(),
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
  observedAt: timestamp.optional(),
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

const storagePoolSchema = z.object({
  id: identifier,
  name: text(256),
  kind: z.enum(["lvmthin", "lvm", "zfs", "btrfs", "dir", "nfs", "cifs", "pbs", "filesystem", "unknown"]),
  source: optionalText(64),
  node: optionalText(128),
  mountPoint: optionalText(1_024),
  device: optionalText(512),
  volumeGroup: optionalText(256),
  thinPool: optionalText(256),
  physicalDevices: z.array(text(128)).max(16).optional(),
  content: z.array(text(32)).max(16).optional(),
  active: z.boolean().nullable().optional(),
  enabled: z.boolean().nullable().optional(),
  shared: z.boolean().nullable().optional(),
  totalBytes: nonNegative,
  usedBytes: nonNegative,
  availableBytes: nonNegative.nullable().optional(),
  dataPercent: percentage.nullable().optional(),
  metadataPercent: percentage.nullable().optional(),
  health: optionalText(64).nullable()
}).passthrough();

const watts = finite.min(0).max(10_000).optional();
const powerSchema = z.object({
  observedAt: timestamp,
  source: text(256),
  systemWatts: watts,
  inputWatts: watts,
  cpuWatts: watts,
  gpuWatts: watts,
  aneWatts: watts,
  dramWatts: watts,
  mediaWatts: watts,
  adapterRatedWatts: watts,
  externalPower: z.boolean().optional()
}).passthrough();

const batterySchema = z.object({
  observedAt: timestamp,
  source: text(256),
  chargePercent: percentage.optional(),
  healthPercent: percentage.optional(),
  cycleCount: nonNegativeInt.max(1_000_000).optional(),
  designCapacityMAh: nonNegative.optional(),
  fullChargeCapacityMAh: nonNegative.optional(),
  temperatureC: finite.min(-100).max(250).optional(),
  voltageV: finite.min(0).max(1_000).optional(),
  amperageMA: finite.min(-1_000_000).max(1_000_000).optional(),
  netPowerWatts: finite.min(-10_000).max(10_000).optional(),
  timeRemainingMinutes: nonNegative.optional(),
  charging: z.boolean().optional(),
  externalPower: z.boolean().optional(),
  fullyCharged: z.boolean().optional(),
  condition: optionalText(128)
}).passthrough();

const thermalSchema = z.object({
  observedAt: timestamp,
  source: text(256),
  pressureLevel: z.enum(["nominal", "moderate", "heavy", "trapping", "sleeping"])
}).passthrough();

export const agentMetricsPayloadSchema = z.object({
  sampleId: optionalText(128),
  identity: identitySchema,
  timestamp,
  heartbeatAt: timestamp,
  hardwareSampledAt: timestamp.optional(),
  cpuTemperatureSampledAt: timestamp.optional(),
  unavailableMetrics: z.array(metricKey).max(64).optional(),
  metricQuality: z.partialRecord(metricKey, z.object({
    state: z.enum(["direct", "derived", "unavailable", "not_applicable", "stale"]),
    source: optionalText(256),
    reason: optionalText(1_024),
    observedAt: timestamp.optional()
  })).optional(),
  system: systemSchema.default({
    processCount: 0,
    threadCount: 0,
    handleCount: 0
  }),
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
  storagePools: z.array(storagePoolSchema).max(256).optional(),
  diskRate: rateSchema,
  networkRate: networkRateSchema,
  networkInterfaces: z.array(networkSchema).max(256).optional(),
  gpus: z.array(gpuSchema).max(128),
  fans: z.array(fanSchema).max(256),
  temperatureSensors: z.array(temperatureSensorSchema).max(1_024).optional(),
  sensorBackends: z.array(sensorBackendSchema).max(128).optional(),
  // Additive collector self-reporting. `.passthrough()` on the parent already
  // preserved these, but making them explicit documents the contract the
  // collector now relies on and bounds an unexpected map/object.
  probeSpawns: z.record(z.string().max(64), nonNegativeInt).refine(
    (value) => Object.keys(value).length <= 32,
    "too many probe spawn entries"
  ).optional(),
  collectorStats: z.object({
    slowRuns: nonNegativeInt,
    slowOverruns: nonNegativeInt,
    lastSlowMillis: nonNegativeInt
  }).passthrough().optional(),
  power: powerSchema.optional(),
  battery: batterySchema.optional(),
  thermal: thermalSchema.optional()
}).passthrough().transform((payload): AgentMetricsPayload => {
  const sanitized = { ...payload } as Record<string, unknown>;
  // `storagePools` used to be purged here as part of the retired virtual
  // machine feature; it is a first-class host metric again, so only the
  // virtual machine payload survives as a legacy deletion.
  delete sanitized.virtualization;
  return sanitized as unknown as AgentMetricsPayload;
});
