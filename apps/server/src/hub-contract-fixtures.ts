import type { AgentMetricsPayload, DiskRateStats } from "@dsc/shared";

export const HUB_CONTRACT_TIMESTAMP = "2026-10-24T00:00:00.000Z";

export interface HubContractHardwareScale {
  cpuPackages: number;
  disks: number;
  networkInterfaces: number;
  gpus: number;
  fans: number;
  temperatureSensors: number;
}

export interface HubContractFixtureOptions {
  deviceId?: string;
  timestamp?: string | number;
  hardware?: Partial<HubContractHardwareScale>;
  metricQuality?: AgentMetricsPayload["metricQuality"];
  unavailableMetrics?: AgentMetricsPayload["unavailableMetrics"];
}

const DEFAULT_HARDWARE: HubContractHardwareScale = {
  cpuPackages: 2,
  disks: 3,
  networkInterfaces: 2,
  gpus: 2,
  fans: 2,
  temperatureSensors: 3
};
const HARDWARE_LIMITS: HubContractHardwareScale = {
  cpuPackages: 256,
  disks: 2_048,
  networkInterfaces: 256,
  gpus: 128,
  fans: 256,
  temperatureSensors: 1_024
};
const GiB = 1024 ** 3;

/**
 * Synthetic, independently mutable input for compatibility tests and benchmarks.
 * No clock, randomness, environment, I/O or test-module imports. The fixed default
 * date is intentional; schema tests must pin Date.now (ingestion has an age gate).
 * Supply a timestamp explicitly when a caller needs a different observation date.
 */
export function createHubContractPayload(options: HubContractFixtureOptions = {}): AgentMetricsPayload {
  const deviceId = options.deviceId ?? "synthetic-hub-contract";
  if (!deviceId.trim() || deviceId.length > 128 || deviceId !== deviceId.trim()) {
    throw new RangeError("deviceId must be an unpadded identifier of 1–128 characters");
  }
  const timestamp = new Date(options.timestamp ?? HUB_CONTRACT_TIMESTAMP).toISOString();
  const scale = { ...DEFAULT_HARDWARE, ...options.hardware };
  for (const key of Object.keys(HARDWARE_LIMITS) as Array<keyof HubContractHardwareScale>) {
    if (!Number.isInteger(scale[key]) || scale[key] < 0 || scale[key] > HARDWARE_LIMITS[key]) {
      throw new RangeError(`${key} must be an integer between 0 and ${HARDWARE_LIMITS[key]}`);
    }
  }

  const cpuPackages = Array.from({ length: scale.cpuPackages }, (_, index) => ({
    id: `cpu-${index}`,
    name: `Synthetic CPU ${index}`,
    socketIndex: index,
    model: "Synthetic CPU",
    coreCount: 8,
    logicalCount: 16,
    l3CacheBytes: 32 * 1024 ** 2,
    usagePercent: 20 + index % 40,
    frequencyMHz: 2_400 + index % 8 * 100,
    temperatureC: 40 + index % 20
  }));
  const disks = Array.from({ length: scale.disks }, (_, index) => ({
    id: `disk-${index}`,
    // Deliberately different from id: rate lookups must respect sourceKey.
    sourceKey: `block-${index}`,
    name: `Synthetic disk ${index}`,
    mountPoint: `/synthetic/disk-${index}`,
    filesystem: "ext4",
    model: "Synthetic SSD",
    vendor: "Synthetic",
    physicalDevice: `/dev/synthetic-${index}`,
    totalBytes: (index % 4 + 1) * 100 * GiB,
    usedBytes: (index % 4 + 1) * 25 * GiB,
    temperatureC: 30 + index % 10,
    healthStatus: "healthy",
    healthPercent: 100,
    interfaceType: "NVMe"
  }));
  const instances: NonNullable<DiskRateStats["instances"]> = {};
  for (const [index, disk] of disks.entries()) {
    instances[disk.sourceKey] = {
      readBytesPerSec: (index + 1) * 1_024,
      writeBytesPerSec: (index + 1) * 512,
      activePercent: index % 50
    };
  }
  const networkInterfaces = Array.from({ length: scale.networkInterfaces }, (_, index) => ({
    id: `net-${index}`,
    name: `synthetic-eth${index}`,
    model: "Synthetic NIC",
    macAddress: `02:00:00:00:00:${index.toString(16).padStart(2, "0")}`,
    ipv4: [`192.0.2.${index % 254 + 1}`],
    ipv6: [],
    rxBytesPerSec: (index + 1) * 2_048,
    txBytesPerSec: (index + 1) * 1_024,
    totalRxBytes: (index + 1) * 1_000_000,
    totalTxBytes: (index + 1) * 500_000,
    linkSpeedMbps: 1_000
  }));
  const gpus: AgentMetricsPayload["gpus"] = Array.from({ length: scale.gpus }, (_, index) => ({
    id: `gpu-${index}`,
    name: `Synthetic GPU ${index}`,
    utilizationPercent: 10 + index % 50,
    encodeUtilizationPercent: index % 20,
    decodeUtilizationPercent: index % 10,
    frequencyMHz: 1_000 + index % 8 * 100,
    integrated: false,
    memoryKind: "dedicated",
    memoryTotalBytes: (index % 4 + 1) * 4 * GiB,
    memoryUsedBytes: (index % 4 + 1) * GiB,
    temperatureC: 50 + index % 20,
    temperatureSource: "synthetic",
    driverVersion: "synthetic-1"
  }));
  const fans: AgentMetricsPayload["fans"] = Array.from({ length: scale.fans }, (_, index) => ({
    id: `fan-${index}`,
    label: `Synthetic fan ${index}`,
    interface: "synthetic-hwmon",
    rpm: index * 100,
    rpmStatus: "observed"
  }));
  const temperatureSensors: AgentMetricsPayload["temperatureSensors"] = Array.from(
    { length: scale.temperatureSensors }, (_, index) => ({
      id: `temp-${index}`,
      source: "synthetic-hwmon",
      rawName: `Synthetic temperature ${index}`,
      role: "motherboard",
      currentC: 35 + index % 20,
      observedAt: timestamp,
      status: "valid",
      confidence: "direct"
    })
  );
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const average = (values: number[]) => values.length ? sum(values) / values.length : 0;

  return {
    identity: { deviceId, hostname: deviceId, os: "linux", platform: "linux", arch: "x64" },
    timestamp,
    heartbeatAt: timestamp,
    hardwareSampledAt: timestamp,
    cpuTemperatureSampledAt: timestamp,
    metricQuality: options.metricQuality ? structuredClone(options.metricQuality) : undefined,
    unavailableMetrics: options.unavailableMetrics ? [...options.unavailableMetrics] : undefined,
    system: { processCount: 120, threadCount: 480, handleCount: 960, uptimeSeconds: 3_600 },
    cpuUsagePercent: average(cpuPackages.map((cpu) => cpu.usagePercent)),
    cpuFrequencyMHz: average(cpuPackages.map((cpu) => cpu.frequencyMHz)),
    cpuTemperatureC: average(cpuPackages.map((cpu) => cpu.temperatureC)),
    cpuPackages,
    memory: {
      totalBytes: 32 * GiB,
      usedBytes: 16 * GiB,
      availableBytes: 16 * GiB,
      cachedBytes: 4 * GiB,
      committedBytes: 20 * GiB,
      commitLimitBytes: 40 * GiB,
      swapTotalBytes: 8 * GiB,
      swapUsedBytes: 0
    },
    diskUsage: { totalBytes: sum(disks.map((disk) => disk.totalBytes)), usedBytes: sum(disks.map((disk) => disk.usedBytes)) },
    disks,
    diskRate: {
      readBytesPerSec: sum(Object.values(instances).map((rate) => rate.readBytesPerSec)),
      writeBytesPerSec: sum(Object.values(instances).map((rate) => rate.writeBytesPerSec)),
      instances
    },
    networkRate: {
      rxBytesPerSec: sum(networkInterfaces.map((network) => network.rxBytesPerSec)),
      txBytesPerSec: sum(networkInterfaces.map((network) => network.txBytesPerSec)),
      totalRxBytes: sum(networkInterfaces.map((network) => network.totalRxBytes)),
      totalTxBytes: sum(networkInterfaces.map((network) => network.totalTxBytes))
    },
    networkInterfaces,
    gpus,
    fans,
    temperatureSensors,
    sensorBackends: [{ id: "synthetic", label: "Synthetic sensors", ok: true }]
  };
}
