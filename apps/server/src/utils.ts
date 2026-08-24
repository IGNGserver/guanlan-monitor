import type {
  AgentMetricsPayload,
  CpuMetricSeries,
  DeviceBlockKey,
  DeviceDetail,
  DeviceMetricKey,
  DeviceMetricOption,
  FanMetricSeries,
  DiskMetricSeries,
  DeviceSummary,
  GpuMetricSeries,
  MetricSeries,
  NetworkMetricSeries,
  TemperatureMetricSeries,
  VirtualizationStorageMetricSeries
} from "@dsc/shared";
import { virtualizationStorageInstances } from "@dsc/shared";
import type { DeviceMetricConfigValue, DeviceRealtimeState, InstanceMetricRecord, TimeSeriesRecord } from "./types.js";

export const HEARTBEAT_TIMEOUT_MS = 45_000;
const DEVICE_DISPLAY_NAMES: Record<string, string> = {
  workstation: "工作站"
};
export const ALL_DEVICE_METRIC_KEYS: DeviceMetricKey[] = [
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
];

export function percent(used: number, total: number) {
  if (!total) return 0;
  return Number(((used / total) * 100).toFixed(2));
}

function positiveFiniteValues(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0
  );
}

function averagePositive(values: Array<number | null | undefined>): number {
  const valid = positiveFiniteValues(values);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

export function resolveCpuTemperatureC(
  payload: Pick<AgentMetricsPayload, "cpuTemperatureC" | "cpuPackages">
): number | null {
  const direct = positiveFiniteValues([payload.cpuTemperatureC])[0];
  if (direct != null) return direct;
  const average = averagePositive((payload.cpuPackages ?? []).map((cpu) => cpu.temperatureC));
  return average > 0 ? average : null;
}

export function toSummary(state: DeviceRealtimeState): DeviceSummary {
  const latest = state.latest;
  const displayName = DEVICE_DISPLAY_NAMES[state.identity.deviceId] ?? state.identity.hostname;
  const gpuUsagePercent =
    latest.gpus.length > 0
      ? Number(
          (latest.gpus.reduce((sum, gpu) => sum + gpu.utilizationPercent, 0) / latest.gpus.length).toFixed(2)
        )
      : null;
  const totalGpuMemoryBytes = latest.gpus.reduce((sum, gpu) => sum + gpu.memoryTotalBytes, 0);
  const usedGpuMemoryBytes = latest.gpus.reduce((sum, gpu) => sum + gpu.memoryUsedBytes, 0);
  return {
    deviceId: state.identity.deviceId,
    hostname: displayName,
    os: state.identity.os,
    agentVersion: state.identity.version ?? null,
    agentChannel: state.identity.channel ?? null,
    status: state.status,
    lastSeenAt: state.lastSeenAt,
    cpuUsagePercent: latest.cpuUsagePercent,
    gpuUsagePercent,
    gpuMemoryUsagePercent: totalGpuMemoryBytes ? percent(usedGpuMemoryBytes, totalGpuMemoryBytes) : null,
    memoryUsagePercent: percent(latest.memory.usedBytes, latest.memory.totalBytes),
    memoryUsedBytes: latest.memory.usedBytes,
    memoryTotalBytes: latest.memory.totalBytes,
    diskUsagePercent: percent(latest.diskUsage.usedBytes, latest.diskUsage.totalBytes),
    diskUsedBytes: latest.diskUsage.usedBytes,
    diskTotalBytes: latest.diskUsage.totalBytes,
    instanceType: state.identity.instanceType ?? "device",
    hostName: state.identity.hostName ?? null,
    virtualMachine: state.identity.virtualMachine ?? null,
    unavailableMetrics: latest.unavailableMetrics ?? []
  };
}

export function toDetail(state: DeviceRealtimeState): DeviceDetail {
  return {
    ...toSummary(state),
    platform: state.identity.platform,
    arch: state.identity.arch,
    cpuModel: state.identity.cpuModel
  };
}

export function payloadToTimeSeries(
  payload: AgentMetricsPayload,
  config: DeviceMetricConfigValue = { enabledMetrics: ALL_DEVICE_METRIC_KEYS }
): TimeSeriesRecord {
  const enabled = new Set(config.enabledMetrics);
  const resolvedCpuFrequencyMHz = resolveCpuFrequencyMHz(payload);
  const resolvedCpuTemperatureC = resolveCpuTemperatureC(payload);
  const cpuPackageCount = (payload.cpuPackages ?? []).length;
  const totalGpuMemory = payload.gpus.reduce((sum, gpu) => sum + gpu.memoryTotalBytes, 0);
  const usedGpuMemory = payload.gpus.reduce((sum, gpu) => sum + gpu.memoryUsedBytes, 0);
  const gpuUsagePercent =
    payload.gpus.length > 0
      ? payload.gpus.reduce((sum, gpu) => sum + gpu.utilizationPercent, 0) / payload.gpus.length
      : 0;
  const gpuFrequencyValues = payload.gpus
    .map((gpu) => gpu.frequencyMHz)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const gpuEncodeValues = payload.gpus
    .map((gpu) => gpu.encodeUtilizationPercent)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const gpuDecodeValues = payload.gpus
    .map((gpu) => gpu.decodeUtilizationPercent)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const gpuTemperatureValues = positiveFiniteValues(payload.gpus.map((gpu) => gpu.temperatureC));
  const disks = (payload.disks ?? [])
    .filter((disk) => isInstanceEnabled(config, "disk", disk.id))
    .map((disk) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, disk.id);
      const rate = payload.diskRate.instances?.[disk.sourceKey ?? disk.id];
      return {
        id: disk.id,
        name: disk.name,
        mountPoint: enabled.has("diskMetadata") && instanceEnabled.has("diskMetadata") ? disk.mountPoint : "",
        filesystem: enabled.has("diskMetadata") && instanceEnabled.has("diskMetadata") ? disk.filesystem : undefined,
        model: enabled.has("diskMetadata") && instanceEnabled.has("diskMetadata") ? disk.model : undefined,
        vendor: enabled.has("diskMetadata") && instanceEnabled.has("diskMetadata") ? disk.vendor : undefined,
        physicalDevice: disk.physicalDevice,
        totalBytes: enabled.has("diskUsage") && instanceEnabled.has("diskUsage") ? disk.totalBytes : 0,
        temperatureC: enabled.has("diskHealth") && instanceEnabled.has("diskHealth") ? disk.temperatureC : undefined,
        healthStatus: enabled.has("diskHealth") && instanceEnabled.has("diskHealth") ? disk.healthStatus : undefined,
        healthReason: enabled.has("diskHealth") && instanceEnabled.has("diskHealth") ? disk.healthReason : undefined,
        healthPercent: enabled.has("diskHealth") && instanceEnabled.has("diskHealth") ? disk.healthPercent : undefined,
        smartAttributes: enabled.has("diskHealth") && instanceEnabled.has("diskHealth") ? disk.smartAttributes : undefined,
        interfaceType: enabled.has("diskMetadata") && instanceEnabled.has("diskMetadata") ? disk.interfaceType : undefined,
        usagePercent: enabled.has("diskUsage") && instanceEnabled.has("diskUsage") ? percent(disk.usedBytes, disk.totalBytes) : 0,
        activePercent: enabled.has("diskActivity") && instanceEnabled.has("diskActivity") ? rate?.activePercent ?? 0 : 0,
        usedBytes: enabled.has("diskUsage") && instanceEnabled.has("diskUsage") ? disk.usedBytes : 0,
        readBytesPerSec: enabled.has("diskRead") && instanceEnabled.has("diskRead") ? rate?.readBytesPerSec ?? 0 : 0,
        writeBytesPerSec: enabled.has("diskWrite") && instanceEnabled.has("diskWrite") ? rate?.writeBytesPerSec ?? 0 : 0
      } satisfies InstanceMetricRecord;
    });
  const cpus = (payload.cpuPackages ?? [])
    .filter((cpu) => isInstanceEnabled(config, "cpu", cpu.id))
    .map((cpu) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, cpu.id);
      return {
        id: cpu.id,
        name: cpu.name,
        socketIndex: cpu.socketIndex,
        model: cpu.model,
        coreCount: enabled.has("cpuTopology") && instanceEnabled.has("cpuTopology") ? cpu.coreCount : undefined,
        logicalCount: enabled.has("cpuTopology") && instanceEnabled.has("cpuTopology") ? cpu.logicalCount : undefined,
        l3CacheBytes: enabled.has("cpuTopology") && instanceEnabled.has("cpuTopology") ? cpu.l3CacheBytes ?? undefined : undefined,
        usagePercent: enabled.has("cpuUsage") && instanceEnabled.has("cpuUsage")
          ? cpu.usagePercent ?? (cpuPackageCount === 1 ? payload.cpuUsagePercent : undefined)
          : undefined,
        frequencyMHz: enabled.has("cpuFrequency") && instanceEnabled.has("cpuFrequency")
          ? cpu.frequencyMHz ?? (cpuPackageCount === 1 ? resolvedCpuFrequencyMHz ?? undefined : undefined)
          : undefined,
        temperatureC: enabled.has("cpuTemperature") && instanceEnabled.has("cpuTemperature")
          ? cpu.temperatureC ?? (cpuPackageCount === 1 ? resolvedCpuTemperatureC ?? undefined : undefined)
          : undefined
      } satisfies InstanceMetricRecord;
    });
  const networks = (payload.networkInterfaces ?? [])
    .filter((network) => isInstanceEnabled(config, "network", network.id))
    .map((network) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, network.id);
      return {
        id: network.id,
        name: network.name,
        model: network.model,
        macAddress: enabled.has("networkIdentity") && instanceEnabled.has("networkIdentity") ? network.macAddress : undefined,
        ipv4: enabled.has("networkIdentity") && instanceEnabled.has("networkIdentity") ? network.ipv4 : undefined,
        ipv6: enabled.has("networkIdentity") && instanceEnabled.has("networkIdentity") ? network.ipv6 : undefined,
        rxBytesPerSec: enabled.has("networkRxRate") && instanceEnabled.has("networkRxRate") ? network.rxBytesPerSec ?? 0 : 0,
        txBytesPerSec: enabled.has("networkTxRate") && instanceEnabled.has("networkTxRate") ? network.txBytesPerSec ?? 0 : 0,
        trafficRxBytes: enabled.has("networkTraffic") && instanceEnabled.has("networkTraffic") ? network.totalRxBytes ?? 0 : 0,
        trafficTxBytes: enabled.has("networkTraffic") && instanceEnabled.has("networkTraffic") ? network.totalTxBytes ?? 0 : 0
      } satisfies InstanceMetricRecord;
    });
  const gpus = payload.gpus
    .filter((gpu) => isInstanceEnabled(config, "gpu", gpu.id))
    .map((gpu) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, gpu.id);
      return ({
        id: gpu.id,
        name: gpu.name,
        usagePercent: enabled.has("gpuUsage") && instanceEnabled.has("gpuUsage") ? gpu.utilizationPercent : 0,
        encodePercent: enabled.has("gpuEncode") && instanceEnabled.has("gpuEncode") ? gpu.encodeUtilizationPercent ?? 0 : 0,
        decodePercent: enabled.has("gpuDecode") && instanceEnabled.has("gpuDecode") ? gpu.decodeUtilizationPercent ?? 0 : 0,
        frequencyMHz: enabled.has("gpuFrequency") && instanceEnabled.has("gpuFrequency") ? gpu.frequencyMHz ?? 0 : 0,
        memoryUsagePercent: enabled.has("gpuMemory") && instanceEnabled.has("gpuMemory") ? percent(gpu.memoryUsedBytes, gpu.memoryTotalBytes) : 0,
        memoryUsedBytes: enabled.has("gpuMemory") && instanceEnabled.has("gpuMemory") ? gpu.memoryUsedBytes : 0,
        integrated: gpu.integrated,
        memoryKind: gpu.memoryKind,
        temperatureC: enabled.has("gpuTemperature") && instanceEnabled.has("gpuTemperature") ? gpu.temperatureC : undefined,
        temperatureSource: enabled.has("gpuTemperature") && instanceEnabled.has("gpuTemperature") ? gpu.temperatureSource ?? undefined : undefined
      } satisfies InstanceMetricRecord);
    });
  const fans = (payload.fans ?? [])
    .filter((fan) => isInstanceEnabled(config, "fan", fan.id))
    .map((fan) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, fan.id);
      return {
        id: fan.id,
        name: fan.label,
        interface: fan.interface,
        rpm: enabled.has("fanRpm") && instanceEnabled.has("fanRpm") ? fan.rpm : 0
      };
    });

  return {
    timestamp: Date.parse(payload.timestamp),
    cpuUsagePercent: enabled.has("cpuUsage") ? payload.cpuUsagePercent : 0,
    cpuFrequencyMHz: enabled.has("cpuFrequency") ? resolvedCpuFrequencyMHz ?? 0 : 0,
    cpuTemperatureC: enabled.has("cpuTemperature") ? resolvedCpuTemperatureC ?? 0 : 0,
    gpuUsagePercent: enabled.has("gpuUsage") ? gpuUsagePercent : 0,
    gpuEncodePercent:
      enabled.has("gpuEncode") && gpuEncodeValues.length > 0
        ? gpuEncodeValues.reduce((sum, value) => sum + value, 0) / gpuEncodeValues.length
        : 0,
    gpuDecodePercent:
      enabled.has("gpuDecode") && gpuDecodeValues.length > 0
        ? gpuDecodeValues.reduce((sum, value) => sum + value, 0) / gpuDecodeValues.length
        : 0,
    gpuFrequencyMHz:
      enabled.has("gpuFrequency") && gpuFrequencyValues.length > 0
        ? gpuFrequencyValues.reduce((sum, value) => sum + value, 0) / gpuFrequencyValues.length
        : 0,
    gpuMemoryUsagePercent: enabled.has("gpuMemory") ? percent(usedGpuMemory, totalGpuMemory) : 0,
    gpuTemperatureC:
      enabled.has("gpuTemperature") && gpuTemperatureValues.length > 0
        ? gpuTemperatureValues.reduce((sum, value) => sum + value, 0) / gpuTemperatureValues.length
        : 0,
    memoryUsagePercent: enabled.has("memoryUsage") ? percent(payload.memory.usedBytes, payload.memory.totalBytes) : 0,
    swapUsagePercent: enabled.has("swapUsage") ? percent(payload.memory.swapUsedBytes, payload.memory.swapTotalBytes) : 0,
    memoryUsedBytes: enabled.has("memoryUsage") ? payload.memory.usedBytes : 0,
    swapUsedBytes: enabled.has("swapUsage") ? payload.memory.swapUsedBytes : 0,
    diskUsagePercent: enabled.has("diskUsage") ? percent(payload.diskUsage.usedBytes, payload.diskUsage.totalBytes) : 0,
    diskUsedBytes: enabled.has("diskUsage") ? payload.diskUsage.usedBytes : 0,
    diskReadBytesPerSec: enabled.has("diskRead") ? payload.diskRate.readBytesPerSec : 0,
    diskWriteBytesPerSec: enabled.has("diskWrite") ? payload.diskRate.writeBytesPerSec : 0,
    networkRxBytesPerSec: enabled.has("networkRxRate") ? payload.networkRate.rxBytesPerSec : 0,
    networkTxBytesPerSec: enabled.has("networkTxRate") ? payload.networkRate.txBytesPerSec : 0,
    trafficRxBytes: enabled.has("networkTraffic") ? payload.networkRate.totalRxBytes : 0,
    trafficTxBytes: enabled.has("networkTraffic") ? payload.networkRate.totalTxBytes : 0,
    cpus,
    disks,
    networks,
    gpus,
    fans,
    recordedDetails: {
      system: payload.system,
      memory: payload.memory,
      cpuPackages: payload.cpuPackages ?? [],
      disks: payload.disks ?? [],
      networkInterfaces: payload.networkInterfaces ?? [],
      gpus: payload.gpus,
      fans: payload.fans ?? [],
      temperatureSensors: enabled.has("temperatureSources") ? payload.temperatureSensors ?? [] : [],
      diskRate: payload.diskRate,
      networkRate: payload.networkRate,
      virtualization: payload.virtualization ?? null
    }
  };
}

export function resolveCpuFrequencyMHz(payload: Pick<AgentMetricsPayload, "cpuFrequencyMHz" | "cpuPackages">) {
  if (typeof payload.cpuFrequencyMHz === "number" && Number.isFinite(payload.cpuFrequencyMHz) && payload.cpuFrequencyMHz > 0) {
    return payload.cpuFrequencyMHz;
  }
  const packageFrequencies = (payload.cpuPackages ?? [])
    .map((cpu) => cpu.frequencyMHz)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (packageFrequencies.length === 0) return null;
  return Number((packageFrequencies.reduce((sum, value) => sum + value, 0) / packageFrequencies.length).toFixed(2));
}

function isInstanceEnabled(config: DeviceMetricConfigValue, blockKey: DeviceBlockKey, instanceId: string) {
  const enabledIds = config.enabledDeviceIds?.[blockKey];
  if (!enabledIds) return true;
  return enabledIds.includes(instanceId);
}

export function filterAgentPayloadInstances(
  payload: AgentMetricsPayload,
  config: DeviceMetricConfigValue = { enabledMetrics: ALL_DEVICE_METRIC_KEYS }
): AgentMetricsPayload {
  return {
    ...payload,
    cpuPackages: (payload.cpuPackages ?? []).filter((cpu) => isInstanceEnabled(config, "cpu", cpu.id)),
    disks: (payload.disks ?? []).filter((disk) => isInstanceEnabled(config, "disk", disk.id)),
    networkInterfaces: (payload.networkInterfaces ?? []).filter((network) => isInstanceEnabled(config, "network", network.id)),
    gpus: (payload.gpus ?? []).filter((gpu) => isInstanceEnabled(config, "gpu", gpu.id)),
    fans: (payload.fans ?? []).filter((fan) => isInstanceEnabled(config, "fan", fan.id))
  };
}

function getInstanceEnabledMetrics(config: DeviceMetricConfigValue, instanceId: string) {
  return new Set(config.instanceMetricConfig?.[instanceId] ?? ALL_DEVICE_METRIC_KEYS);
}

export function timeSeriesToMetricSeries(
  points: TimeSeriesRecord[],
  config: DeviceMetricConfigValue = { enabledMetrics: ALL_DEVICE_METRIC_KEYS }
): MetricSeries {
  const enabled = new Set(config.enabledMetrics);
  const trafficSeriesRx = normalizeTrafficSeries(points.map((point) => point.trafficRxBytes));
  const trafficSeriesTx = normalizeTrafficSeries(points.map((point) => point.trafficTxBytes));

  const mapPoint = (key: keyof TimeSeriesRecord) => {
    const mapped = points.map((point) => {
      const numeric = Number(point[key]);
      return {
        timestamp: new Date(point.timestamp).toISOString(),
        // Older MySQL rows predate some capacity fields. Keep their charts
        // readable instead of serializing NaN as JSON null for native clients.
        value: Number.isFinite(numeric) ? numeric : 0
      };
    });
    if (key === "cpuTemperatureC" || key === "gpuTemperatureC") {
      return mapped.filter((point) => point.value > 0);
    }
    return mapped;
  };

  const cpus = buildCpuMetricSeries(points, config);
  const disks = buildDiskMetricSeries(points, config);
  const networks = buildNetworkMetricSeries(points, config);
  const gpus = buildGpuMetricSeries(points, config);
  const fans = buildFanMetricSeries(points, config);
  const temperatureSensors = buildTemperatureMetricSeries(points, config);
  const storagePools = buildVirtualizationStorageMetricSeries(points);

  return {
    cpuUsagePercent: mapPoint("cpuUsagePercent"),
    cpuFrequencyMHz: mapPoint("cpuFrequencyMHz"),
    cpuTemperatureC: mapPoint("cpuTemperatureC"),
    gpuUsagePercent: mapPoint("gpuUsagePercent"),
    gpuEncodePercent: mapPoint("gpuEncodePercent"),
    gpuDecodePercent: mapPoint("gpuDecodePercent"),
    gpuFrequencyMHz: mapPoint("gpuFrequencyMHz"),
    gpuMemoryUsagePercent: mapPoint("gpuMemoryUsagePercent"),
    gpuMemoryUsedBytes: detailSeriesWithCarryForward(points, (point) => {
      if (!enabled.has("gpuMemory")) return undefined;
      const gpus = point.gpus?.length ? point.gpus : point.recordedDetails?.gpus ?? [];
      const values = gpus.map((gpu) => Number(gpu.memoryUsedBytes ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
      return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
    }),
    gpuTemperatureC: mapPoint("gpuTemperatureC"),
    memoryUsagePercent: mapPoint("memoryUsagePercent"),
    swapUsagePercent: mapPoint("swapUsagePercent"),
    memoryUsedBytes: detailSeries(points, (point) => {
      if (Number(point.memoryUsedBytes) > 0) return point.memoryUsedBytes;
      return point.recordedDetails?.memory.usedBytes;
    }),
    swapUsedBytes: mapPoint("swapUsedBytes"),
    memoryAvailableBytes: detailSeries(points, (point) => enabled.has("memoryAvailable") ? point.recordedDetails?.memory.availableBytes : 0),
    memoryCachedBytes: detailSeries(points, (point) => enabled.has("memoryCached") ? point.recordedDetails?.memory.cachedBytes : 0),
    memoryCommittedBytes: detailSeries(points, (point) => enabled.has("memoryCommitted") ? point.recordedDetails?.memory.committedBytes : 0),
    memoryCommitLimitBytes: detailSeries(points, (point) => enabled.has("memoryCommitted") ? point.recordedDetails?.memory.commitLimitBytes : 0),
    systemProcessCount: detailSeries(points, (point) => enabled.has("systemOverview") ? point.recordedDetails?.system.processCount : 0),
    systemThreadCount: detailSeries(points, (point) => enabled.has("systemOverview") ? point.recordedDetails?.system.threadCount : 0),
    systemHandleCount: detailSeries(points, (point) => enabled.has("systemOverview") ? point.recordedDetails?.system.handleCount : 0),
    diskUsagePercent: mapPoint("diskUsagePercent"),
    diskUsedBytes: detailSeries(points, (point) => {
      if (Number(point.diskUsedBytes) > 0) return point.diskUsedBytes;
      const disks = point.disks?.length ? point.disks : point.recordedDetails?.disks ?? [];
      return disks.reduce((total, disk) => total + Number(disk.usedBytes ?? 0), 0);
    }),
    diskReadBytesPerSec: mapPoint("diskReadBytesPerSec"),
    diskWriteBytesPerSec: mapPoint("diskWriteBytesPerSec"),
    networkRxBytesPerSec: mapPoint("networkRxBytesPerSec"),
    networkTxBytesPerSec: mapPoint("networkTxBytesPerSec"),
    trafficRxBytes: points.map((point, index) => ({
      timestamp: new Date(point.timestamp).toISOString(),
      value: trafficSeriesRx[index] ?? 0
    })),
    trafficTxBytes: points.map((point, index) => ({
      timestamp: new Date(point.timestamp).toISOString(),
      value: trafficSeriesTx[index] ?? 0
    })),
    cpus,
    disks,
    networks,
    gpus,
    fans,
    temperatureSensors,
    storagePools
  };
}

function detailSeries(points: TimeSeriesRecord[], selector: (point: TimeSeriesRecord) => number | undefined) {
  return points.map((point) => ({
    timestamp: new Date(point.timestamp).toISOString(),
    value: Number(selector(point) ?? 0)
  }));
}

function detailSeriesWithCarryForward(points: TimeSeriesRecord[], selector: (point: TimeSeriesRecord) => number | undefined) {
  let previous = 0;
  return points.map((point) => {
    const selected = Number(selector(point));
    if (Number.isFinite(selected) && selected > 0) {
      previous = selected;
    }
    return {
      timestamp: new Date(point.timestamp).toISOString(),
      value: previous
    };
  });
}

function normalizeTrafficSeries(values: number[]) {
  if (!values.length) return [];

  let baseline = values[0] ?? 0;
  let previousRaw = values[0] ?? 0;

  return values.map((value) => {
    if (value < previousRaw || value - previousRaw > 50_000_000) {
      baseline = value;
    }
    previousRaw = value;
    return Math.max(0, value - baseline);
  });
}

function cpuInstancesAtPoint(point: TimeSeriesRecord, config: DeviceMetricConfigValue): InstanceMetricRecord[] {
  const recordedCpuPackages = point.recordedDetails?.cpuPackages ?? [];
  const aggregateTemperature = recordedCpuPackages.length === 1 ? point.cpuTemperatureC : undefined;
  const instances = point.cpus ?? recordedCpuPackages.map((cpu) => ({
    id: cpu.id,
    name: cpu.name,
    socketIndex: cpu.socketIndex,
    model: cpu.model,
    coreCount: cpu.coreCount,
    logicalCount: cpu.logicalCount,
    l3CacheBytes: cpu.l3CacheBytes ?? undefined,
    usagePercent: cpu.usagePercent ?? (recordedCpuPackages.length === 1 ? point.cpuUsagePercent : undefined),
    frequencyMHz: cpu.frequencyMHz ?? (recordedCpuPackages.length === 1 ? point.cpuFrequencyMHz : undefined),
    temperatureC: cpu.temperatureC ?? aggregateTemperature
  }));
  return instances.filter((cpu) => isInstanceEnabled(config, "cpu", cpu.id));
}

function diskInstancesAtPoint(point: TimeSeriesRecord, config: DeviceMetricConfigValue): InstanceMetricRecord[] {
	const details = point.recordedDetails;
	const instances = point.disks ?? (details?.disks ?? []).map((disk) => {
		const rate = details?.diskRate?.instances?.[disk.sourceKey ?? disk.id] ?? details?.diskRate?.instances?.[disk.id];
		return {
			id: disk.id,
			name: disk.name,
			mountPoint: disk.mountPoint,
			filesystem: disk.filesystem,
			model: disk.model,
			vendor: disk.vendor,
			physicalDevice: disk.physicalDevice,
			totalBytes: disk.totalBytes,
			usagePercent: percent(disk.usedBytes, disk.totalBytes),
			activePercent: rate?.activePercent ?? disk.activePercent ?? 0,
			usedBytes: disk.usedBytes,
			readBytesPerSec: rate?.readBytesPerSec ?? 0,
			writeBytesPerSec: rate?.writeBytesPerSec ?? 0,
			temperatureC: disk.temperatureC
		};
	});
	return instances
		.filter((disk) => isInstanceEnabled(config, "disk", disk.id))
		.map((disk) => {
			if (Number(disk.totalBytes ?? 0) > 0) return disk;
			const detail = (details?.disks ?? []).find((item) => item.id === disk.id);
			if (!detail || Number(detail.totalBytes ?? 0) <= 0) return disk;
			return {
				...disk,
				totalBytes: detail.totalBytes,
				usagePercent: percent(Number(disk.usedBytes ?? detail.usedBytes ?? 0), detail.totalBytes)
			};
		});
}

function networkInstancesAtPoint(point: TimeSeriesRecord, config: DeviceMetricConfigValue): InstanceMetricRecord[] {
  const instances = point.networks ?? (point.recordedDetails?.networkInterfaces ?? []).map((network) => ({
    id: network.id,
    name: network.name,
    model: network.model,
    macAddress: network.macAddress,
    ipv4: network.ipv4,
    ipv6: network.ipv6,
    rxBytesPerSec: network.rxBytesPerSec ?? 0,
    txBytesPerSec: network.txBytesPerSec ?? 0,
    trafficRxBytes: network.totalRxBytes ?? 0,
    trafficTxBytes: network.totalTxBytes ?? 0
  }));
  return instances.filter((network) => isInstanceEnabled(config, "network", network.id));
}

function gpuInstancesAtPoint(point: TimeSeriesRecord, config: DeviceMetricConfigValue): InstanceMetricRecord[] {
  const instances = point.gpus ?? (point.recordedDetails?.gpus ?? []).map((gpu) => ({
    id: gpu.id,
    name: gpu.name,
    usagePercent: gpu.utilizationPercent,
    encodePercent: gpu.encodeUtilizationPercent ?? 0,
    decodePercent: gpu.decodeUtilizationPercent ?? 0,
    frequencyMHz: gpu.frequencyMHz ?? 0,
    memoryUsagePercent: percent(gpu.memoryUsedBytes, gpu.memoryTotalBytes),
    memoryUsedBytes: gpu.memoryUsedBytes,
    integrated: gpu.integrated,
    memoryKind: gpu.memoryKind,
    temperatureC: gpu.temperatureC,
    temperatureSource: gpu.temperatureSource
  }));
  return instances.filter((gpu) => isInstanceEnabled(config, "gpu", gpu.id));
}

function fanInstancesAtPoint(point: TimeSeriesRecord, config: DeviceMetricConfigValue): InstanceMetricRecord[] {
  const instances = point.fans ?? (point.recordedDetails?.fans ?? []).map((fan) => ({
    id: fan.id,
    name: fan.label,
    interface: fan.interface,
    rpm: fan.rpm
  }));
  return instances.filter((fan) => isInstanceEnabled(config, "fan", fan.id));
}

function buildCpuMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): CpuMetricSeries[] {
  const grouped = new Map<string, CpuMetricSeries>();
  const lastTemperature = new Map<string, number>();
  for (const point of points) {
    for (const cpu of cpuInstancesAtPoint(point, config)) {
      if (!grouped.has(cpu.id)) {
        grouped.set(cpu.id, {
          id: cpu.id,
          name: cpu.name,
          socketIndex: cpu.socketIndex,
          model: cpu.model,
          coreCount: cpu.coreCount,
          logicalCount: cpu.logicalCount,
          l3CacheBytes: cpu.l3CacheBytes ?? undefined,
          usagePercent: [],
          frequencyMHz: [],
          temperatureC: []
        });
      }
      const target = grouped.get(cpu.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      if (typeof cpu.usagePercent === "number" && Number.isFinite(cpu.usagePercent)) {
        target.usagePercent.push({ timestamp, value: cpu.usagePercent });
      }
      if (typeof cpu.frequencyMHz === "number" && Number.isFinite(cpu.frequencyMHz) && cpu.frequencyMHz > 0) {
        target.frequencyMHz.push({ timestamp, value: cpu.frequencyMHz });
      }
      const temperature = Number(cpu.temperatureC);
      if (Number.isFinite(temperature) && temperature > 0) {
        lastTemperature.set(cpu.id, temperature);
      }
      const usableTemperature = lastTemperature.get(cpu.id);
      if (usableTemperature != null) {
        target.temperatureC.push({ timestamp, value: usableTemperature });
      }
    }
  }
  return [...grouped.values()];
}

function buildDiskMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): DiskMetricSeries[] {
  const grouped = new Map<string, DiskMetricSeries>();
  for (const point of points) {
    for (const disk of diskInstancesAtPoint(point, config)) {
      if (!grouped.has(disk.id)) {
        grouped.set(disk.id, {
          id: disk.id,
          name: disk.name,
          mountPoint: disk.mountPoint ?? "",
          filesystem: disk.filesystem,
          model: disk.model,
          vendor: disk.vendor,
          physicalDevice: disk.physicalDevice,
          totalBytes: [],
          usagePercent: [],
          activePercent: [],
          usedBytes: [],
          readBytesPerSec: [],
          writeBytesPerSec: [],
          temperatureC: []
        });
      }
      const target = grouped.get(disk.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      target.totalBytes.push({ timestamp, value: Number(disk.totalBytes ?? 0) });
      target.usagePercent.push({ timestamp, value: Number(disk.usagePercent ?? 0) });
      target.activePercent.push({ timestamp, value: Number(disk.activePercent ?? 0) });
      target.usedBytes.push({ timestamp, value: Number(disk.usedBytes ?? 0) });
      target.readBytesPerSec.push({ timestamp, value: Number(disk.readBytesPerSec ?? 0) });
      target.writeBytesPerSec.push({ timestamp, value: Number(disk.writeBytesPerSec ?? 0) });
      const temperature = Number(disk.temperatureC);
      if (Number.isFinite(temperature) && temperature > 0) {
        target.temperatureC.push({ timestamp, value: temperature });
      }
    }
  }
  return [...grouped.values()];
}

function buildVirtualizationStorageMetricSeries(points: TimeSeriesRecord[]): VirtualizationStorageMetricSeries[] {
  const grouped = new Map<string, VirtualizationStorageMetricSeries>();
  for (const point of points) {
    const snapshot = point.recordedDetails?.virtualization;
    for (const storage of virtualizationStorageInstances(snapshot)) {
      if (!grouped.has(storage.id)) {
        grouped.set(storage.id, {
          id: storage.id,
          name: storage.name,
          node: storage.node,
          type: storage.type,
          active: storage.active,
          shared: storage.shared,
          totalBytes: [],
          usedBytes: [],
          availableBytes: [],
          usagePercent: []
        });
      }
      const target = grouped.get(storage.id)!;
      if (storage.name) target.name = storage.name;
      if (storage.node != null) target.node = storage.node;
      if (storage.type != null) target.type = storage.type;
      if (storage.active != null) target.active = storage.active;
      if (storage.shared != null) target.shared = storage.shared;

      const timestamp = new Date(point.timestamp).toISOString();
      const append = (targetPoints: Array<{ timestamp: string; value: number }>, value: number | null | undefined) => {
        if (typeof value === "number" && Number.isFinite(value)) {
          targetPoints.push({ timestamp, value });
        }
      };
      append(target.totalBytes, storage.totalBytes);
      append(target.usedBytes, storage.usedBytes);
      append(target.availableBytes, storage.availableBytes);
      if (
        typeof storage.totalBytes === "number" && Number.isFinite(storage.totalBytes) && storage.totalBytes > 0
        && typeof storage.usedBytes === "number" && Number.isFinite(storage.usedBytes) && storage.usedBytes >= 0
      ) {
        append(target.usagePercent, Number(((storage.usedBytes / storage.totalBytes) * 100).toFixed(2)));
      }
    }
  }
  return [...grouped.values()];
}

function buildNetworkMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): NetworkMetricSeries[] {
  const grouped = new Map<string, NetworkMetricSeries>();
  for (const point of points) {
    for (const network of networkInstancesAtPoint(point, config)) {
      if (!grouped.has(network.id)) {
        grouped.set(network.id, {
          id: network.id,
          name: network.name,
          model: network.model,
          macAddress: network.macAddress,
          ipv4: network.ipv4,
          ipv6: network.ipv6,
          rxBytesPerSec: [],
          txBytesPerSec: [],
          trafficRxBytes: [],
          trafficTxBytes: []
        });
      }
    }
  }

  // Emit one point for every known interface at every timestamp. Missing
  // interfaces are idle, not copies of whichever interface had traffic.
  for (const point of points) {
    const timestamp = new Date(point.timestamp).toISOString();
    const networksAtPoint = new Map(networkInstancesAtPoint(point, config).map((network) => [network.id, network]));
    for (const target of grouped.values()) {
      const network = networksAtPoint.get(target.id);
      target.rxBytesPerSec.push({ timestamp, value: Number(network?.rxBytesPerSec ?? 0) });
      target.txBytesPerSec.push({ timestamp, value: Number(network?.txBytesPerSec ?? 0) });
      target.trafficRxBytes.push({ timestamp, value: Number(network?.trafficRxBytes ?? 0) });
      target.trafficTxBytes.push({ timestamp, value: Number(network?.trafficTxBytes ?? 0) });
    }
  }

  for (const target of grouped.values()) {
    const normalizedRx = normalizeTrafficSeries(target.trafficRxBytes.map((point) => point.value));
    const normalizedTx = normalizeTrafficSeries(target.trafficTxBytes.map((point) => point.value));
    target.trafficRxBytes = target.trafficRxBytes.map((point, index) => ({ ...point, value: normalizedRx[index] ?? 0 }));
    target.trafficTxBytes = target.trafficTxBytes.map((point, index) => ({ ...point, value: normalizedTx[index] ?? 0 }));
  }

  return [...grouped.values()];
}

function buildGpuMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): GpuMetricSeries[] {
  const grouped = new Map<string, GpuMetricSeries>();
  const lastTemperature = new Map<string, number>();
  const lastMemoryUsed = new Map<string, number>();
  for (const point of points) {
    for (const gpu of gpuInstancesAtPoint(point, config)) {
      if (!grouped.has(gpu.id)) {
        grouped.set(gpu.id, {
          id: gpu.id,
          name: gpu.name,
          integrated: gpu.integrated,
          memoryKind: gpu.memoryKind,
          usagePercent: [],
          encodePercent: [],
          decodePercent: [],
          frequencyMHz: [],
          memoryUsagePercent: [],
          memoryUsedBytes: [],
          temperatureC: []
        });
      }
      const target = grouped.get(gpu.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      if (gpu.integrated) target.integrated = true;
      if ((!target.memoryKind || target.memoryKind === "unknown") && gpu.memoryKind) {
        target.memoryKind = gpu.memoryKind;
      }
      target.usagePercent.push({ timestamp, value: Number(gpu.usagePercent ?? 0) });
      target.encodePercent.push({ timestamp, value: Number(gpu.encodePercent ?? 0) });
      target.decodePercent.push({ timestamp, value: Number(gpu.decodePercent ?? 0) });
      target.frequencyMHz.push({ timestamp, value: Number(gpu.frequencyMHz ?? 0) });
      target.memoryUsagePercent.push({ timestamp, value: Number(gpu.memoryUsagePercent ?? 0) });
      const memoryUsed = Number(gpu.memoryUsedBytes ?? 0);
      if (Number.isFinite(memoryUsed) && memoryUsed > 0) {
        lastMemoryUsed.set(gpu.id, memoryUsed);
      }
      target.memoryUsedBytes.push({ timestamp, value: lastMemoryUsed.get(gpu.id) ?? 0 });
      if (gpu.temperatureSource === "cpuPackageShared" || (!target.temperatureSource && gpu.temperatureSource)) {
        target.temperatureSource = gpu.temperatureSource;
      }
      const temperature = Number(gpu.temperatureC);
      if (Number.isFinite(temperature) && temperature > 0) {
        lastTemperature.set(gpu.id, temperature);
      }
      const usableTemperature = lastTemperature.get(gpu.id);
      if (usableTemperature != null) {
        target.temperatureC.push({ timestamp, value: usableTemperature });
      }
    }
  }
  return [...grouped.values()];
}

function buildFanMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): FanMetricSeries[] {
  const grouped = new Map<string, FanMetricSeries>();
  for (const point of points) {
    for (const fan of fanInstancesAtPoint(point, config)) {
      if (!grouped.has(fan.id)) {
        grouped.set(fan.id, {
          id: fan.id,
          name: fan.name,
          interface: fan.interface ?? "",
          rpm: []
        });
      }
      const target = grouped.get(fan.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      target.rpm.push({ timestamp, value: Number(fan.rpm ?? 0) });
    }
  }
  return [...grouped.values()];
}

function buildTemperatureMetricSeries(points: TimeSeriesRecord[], config: DeviceMetricConfigValue): TemperatureMetricSeries[] {
  if (!new Set(config.enabledMetrics).has("temperatureSources")) return [];
  const grouped = new Map<string, TemperatureMetricSeries>();
  for (const point of points) {
    for (const sensor of point.recordedDetails?.temperatureSensors ?? []) {
      const name = sensor.displayName || [sensor.hardware, sensor.rawName].filter(Boolean).join(" · ") || sensor.rawName;
      if (!grouped.has(sensor.id)) {
        grouped.set(sensor.id, {
          id: sensor.id,
          name,
          rawName: sensor.rawName,
          source: sensor.source,
          backend: sensor.backend,
          hardware: sensor.hardware,
          role: sensor.role,
          confidence: sensor.confidence,
          status: sensor.status,
          currentC: []
        });
      }
      const target = grouped.get(sensor.id)!;
      target.name = name;
      target.status = sensor.status;
      target.confidence = sensor.confidence;
      target.highC = sensor.highC ?? target.highC;
      target.criticalC = sensor.criticalC ?? target.criticalC;
      target.emergencyC = sensor.emergencyC ?? target.emergencyC;
      const current = Number(sensor.currentC);
      if (sensor.status === "valid" && Number.isFinite(current) && current > 0) {
        target.currentC.push({ timestamp: new Date(point.timestamp).toISOString(), value: current });
      }
    }
  }
  return [...grouped.values()];
}

export function getAvailableMetrics(state: DeviceRealtimeState): DeviceMetricOption[] {
  const latest = state.latest;
  const unavailable = new Set(latest.unavailableMetrics ?? []);
  const hasGpu = latest.gpus.length > 0;
  const hasGpuFrequency = latest.gpus.some((gpu) => gpu.frequencyMHz != null);
  const hasGpuEncode = latest.gpus.some((gpu) => gpu.encodeUtilizationPercent != null);
  const hasGpuDecode = latest.gpus.some((gpu) => gpu.decodeUtilizationPercent != null);
  const hasGpuTemperature = latest.gpus.some((gpu) => gpu.temperatureC != null);
  const hasTemperatureSources = (latest.temperatureSensors?.length ?? 0) > 0;
  const hasSwap = latest.memory.swapTotalBytes > 0 || latest.memory.swapUsedBytes > 0;
  const hasCpuFrequency =
    (latest.cpuFrequencyMHz ?? 0) > 0 || (latest.cpuPackages ?? []).some((cpu) => (cpu.frequencyMHz ?? 0) > 0);
  const hasCpuTemperature = resolveCpuTemperatureC(latest) != null;
  const hasCpuTopology = (latest.cpuPackages ?? []).some((cpu) => cpu.coreCount != null || cpu.logicalCount != null);
  const hasSystemOverview = latest.system.processCount > 0 || latest.system.threadCount > 0 || latest.system.handleCount > 0;
  const hasDisks = latest.diskUsage.totalBytes > 0 || (latest.disks?.length ?? 0) > 0;
  const hasDiskMetadata = (latest.disks ?? []).some((disk) =>
    Boolean(disk.mountPoint || disk.filesystem || disk.model || disk.vendor || disk.interfaceType)
  );
  const hasDiskActivity = (latest.disks ?? []).some((disk) => disk.activePercent != null || disk.averageResponseMs != null);
  const hasDiskHealth = (latest.disks ?? []).some((disk) =>
    disk.temperatureC != null || disk.healthStatus != null || disk.healthPercent != null || (disk.smartAttributes?.length ?? 0) > 0
  );
  const hasNetworkInterfaces = (latest.networkInterfaces?.length ?? 0) > 0;
  const hasNetworkIdentity = (latest.networkInterfaces ?? []).some((network) =>
    Boolean(network.macAddress || network.ipv4?.length || network.ipv6?.length || network.linkSpeedMbps != null || network.connectionType)
  );
  const hasFan = (latest.fans?.length ?? 0) > 0;
  const hasFanControl = (latest.fans ?? []).some((fan) => fan.controlMode != null);
  const hasFanTargetTemperature = (latest.fans ?? []).some((fan) => fan.targetTemperatureC != null);
  const hasFanPwm = (latest.fans ?? []).some((fan) => fan.minPwmPercent != null || fan.maxPwmPercent != null);
  const hasFanChannelState = (latest.fans ?? []).some((fan) => fan.channelState != null);
  const hasFanNote = (latest.fans ?? []).some((fan) => fan.note != null);

  const availabilityEntries: Array<[DeviceMetricKey, boolean]> = [
    ["cpuUsage", true],
    ["cpuFrequency", hasCpuFrequency],
    ["cpuTemperature", hasCpuTemperature],
    ["cpuTopology", hasCpuTopology],
    ["systemOverview", hasSystemOverview],
    ["gpuUsage", hasGpu],
    ["gpuEncode", hasGpuEncode],
    ["gpuDecode", hasGpuDecode],
    ["gpuFrequency", hasGpuFrequency],
    ["gpuMemory", hasGpu],
    ["gpuTemperature", hasGpuTemperature],
    ["gpuDriverInfo", latest.gpus.some((gpu) => gpu.driverVersion != null)],
    ["temperatureSources", hasTemperatureSources],
    ["memoryUsage", latest.memory.totalBytes > 0],
    ["swapUsage", hasSwap],
    ["memoryAvailable", latest.memory.availableBytes > 0],
    ["memoryCached", latest.memory.cachedBytes > 0],
    ["memoryCommitted", latest.memory.committedBytes > 0],
    ["memoryHardware", latest.memory.speedMHz != null || latest.memory.slotCount != null || latest.memory.formFactor != null],
    ["diskUsage", hasDisks],
    ["diskRead", true],
    ["diskWrite", true],
    ["diskMetadata", hasDiskMetadata],
    ["diskActivity", hasDiskActivity],
    ["diskHealth", hasDiskHealth],
    ["networkRxRate", hasNetworkInterfaces],
    ["networkTxRate", hasNetworkInterfaces],
    ["networkTraffic", hasNetworkInterfaces],
    ["networkIdentity", hasNetworkIdentity],
    ["fanRpm", hasFan],
    ["fanControl", hasFanControl],
    ["fanTargetTemperature", hasFanTargetTemperature],
    ["fanPwm", hasFanPwm],
    ["fanChannelState", hasFanChannelState],
    ["fanNote", hasFanNote]
  ];
  const availability = new Map<DeviceMetricKey, boolean>(
    availabilityEntries.map(([key, available]) => [key, unavailable.has(key) ? false : available])
  );

  return ALL_DEVICE_METRIC_KEYS.map((key) => ({
    key,
    available: availability.get(key) ?? false
  }));
}
