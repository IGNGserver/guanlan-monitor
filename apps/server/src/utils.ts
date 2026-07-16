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
  NetworkMetricSeries
} from "@dsc/shared";
import type { DeviceMetricConfigValue, DeviceRealtimeState, InstanceMetricRecord, TimeSeriesRecord } from "./types.js";

export const HEARTBEAT_TIMEOUT_MS = 45_000;
const DEVICE_DISPLAY_NAMES: Record<string, string> = {
  workstation: "工作站"
};
export const ALL_DEVICE_METRIC_KEYS: DeviceMetricKey[] = [
  "cpuUsage",
  "cpuFrequency",
  "cpuTemperature",
  "gpuUsage",
  "gpuEncode",
  "gpuDecode",
  "gpuFrequency",
  "gpuMemory",
  "gpuTemperature",
  "memoryUsage",
  "swapUsage",
  "diskUsage",
  "diskRead",
  "diskWrite",
  "networkRxRate",
  "networkTxRate",
  "networkTraffic"
];

export function percent(used: number, total: number) {
  if (!total) return 0;
  return Number(((used / total) * 100).toFixed(2));
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
    status: state.status,
    lastSeenAt: state.lastSeenAt,
    cpuUsagePercent: latest.cpuUsagePercent,
    gpuUsagePercent,
    gpuMemoryUsagePercent: totalGpuMemoryBytes ? percent(usedGpuMemoryBytes, totalGpuMemoryBytes) : null,
    memoryUsagePercent: percent(latest.memory.usedBytes, latest.memory.totalBytes),
    diskUsagePercent: percent(latest.diskUsage.usedBytes, latest.diskUsage.totalBytes)
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
  const gpuTemperatureValues = payload.gpus.map((gpu) => gpu.temperatureC).filter((value): value is number => value != null);
  const disks = (payload.disks ?? [])
    .filter((disk) => isInstanceEnabled(config, "disk", disk.id))
    .map((disk) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, disk.id);
      const rate = payload.diskRate.instances?.[disk.sourceKey ?? disk.id];
      return {
        id: disk.id,
        name: disk.name,
        mountPoint: disk.mountPoint,
        filesystem: disk.filesystem,
        model: disk.model,
        vendor: disk.vendor,
        temperatureC: disk.temperatureC ?? 0,
        usagePercent: enabled.has("diskUsage") && instanceEnabled.has("diskUsage") ? percent(disk.usedBytes, disk.totalBytes) : 0,
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
        model: cpu.model,
        coreCount: cpu.coreCount,
        logicalCount: cpu.logicalCount,
        usagePercent: enabled.has("cpuUsage") && instanceEnabled.has("cpuUsage") ? cpu.usagePercent ?? payload.cpuUsagePercent : 0,
        frequencyMHz: enabled.has("cpuFrequency") && instanceEnabled.has("cpuFrequency") ? cpu.frequencyMHz ?? resolvedCpuFrequencyMHz ?? 0 : 0,
        temperatureC: enabled.has("cpuTemperature") && instanceEnabled.has("cpuTemperature") ? cpu.temperatureC ?? payload.cpuTemperatureC ?? 0 : 0
      } satisfies InstanceMetricRecord;
    });
  const networks = (payload.networkInterfaces ?? [])
    .filter((network) => isInstanceEnabled(config, "network", network.id))
    .map((network) => {
      const instanceEnabled = getInstanceEnabledMetrics(config, network.id);
      return {
        id: network.id,
        name: network.name,
        macAddress: network.macAddress,
        ipv4: network.ipv4,
        ipv6: network.ipv6,
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
        temperatureC: enabled.has("gpuTemperature") && instanceEnabled.has("gpuTemperature") ? gpu.temperatureC ?? 0 : 0
      } satisfies InstanceMetricRecord);
    });
  const fans = (payload.fans ?? []).map((fan) => ({
    id: fan.id,
    name: fan.label,
    interface: fan.interface,
    rpm: fan.rpm
  }));

  return {
    timestamp: Date.parse(payload.timestamp),
    cpuUsagePercent: enabled.has("cpuUsage") ? payload.cpuUsagePercent : 0,
    cpuFrequencyMHz: enabled.has("cpuFrequency") ? resolvedCpuFrequencyMHz ?? 0 : 0,
    cpuTemperatureC: enabled.has("cpuTemperature") ? payload.cpuTemperatureC ?? 0 : 0,
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
    fans
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
  if (!enabledIds || enabledIds.length === 0) return true;
  return enabledIds.includes(instanceId);
}

function getInstanceEnabledMetrics(config: DeviceMetricConfigValue, instanceId: string) {
  return new Set(config.instanceMetricConfig?.[instanceId] ?? ALL_DEVICE_METRIC_KEYS);
}

export function timeSeriesToMetricSeries(points: TimeSeriesRecord[]): MetricSeries {
  const trafficSeriesRx = normalizeTrafficSeries(points.map((point) => point.trafficRxBytes));
  const trafficSeriesTx = normalizeTrafficSeries(points.map((point) => point.trafficTxBytes));

  const mapPoint = (key: keyof TimeSeriesRecord) =>
    points.map((point) => ({
      timestamp: new Date(point.timestamp).toISOString(),
      value: Number(point[key])
    }));

  const cpus = buildCpuMetricSeries(points);
  const disks = buildDiskMetricSeries(points);
  const networks = buildNetworkMetricSeries(points);
  const gpus = buildGpuMetricSeries(points);
  const fans = buildFanMetricSeries(points);

  return {
    cpuUsagePercent: mapPoint("cpuUsagePercent"),
    cpuFrequencyMHz: mapPoint("cpuFrequencyMHz"),
    cpuTemperatureC: mapPoint("cpuTemperatureC"),
    gpuUsagePercent: mapPoint("gpuUsagePercent"),
    gpuEncodePercent: mapPoint("gpuEncodePercent"),
    gpuDecodePercent: mapPoint("gpuDecodePercent"),
    gpuFrequencyMHz: mapPoint("gpuFrequencyMHz"),
    gpuMemoryUsagePercent: mapPoint("gpuMemoryUsagePercent"),
    gpuTemperatureC: mapPoint("gpuTemperatureC"),
    memoryUsagePercent: mapPoint("memoryUsagePercent"),
    swapUsagePercent: mapPoint("swapUsagePercent"),
    memoryUsedBytes: mapPoint("memoryUsedBytes"),
    swapUsedBytes: mapPoint("swapUsedBytes"),
    diskUsagePercent: mapPoint("diskUsagePercent"),
    diskUsedBytes: mapPoint("diskUsedBytes"),
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
    fans
  };
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

function buildCpuMetricSeries(points: TimeSeriesRecord[]): CpuMetricSeries[] {
  const grouped = new Map<string, CpuMetricSeries>();
  for (const point of points) {
    for (const cpu of point.cpus ?? []) {
      if (!grouped.has(cpu.id)) {
        grouped.set(cpu.id, {
          id: cpu.id,
          name: cpu.name,
          model: cpu.model,
          coreCount: cpu.coreCount,
          logicalCount: cpu.logicalCount,
          usagePercent: [],
          frequencyMHz: [],
          temperatureC: []
        });
      }
      const target = grouped.get(cpu.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      target.usagePercent.push({ timestamp, value: Number(cpu.usagePercent ?? 0) });
      target.frequencyMHz.push({ timestamp, value: Number(cpu.frequencyMHz ?? 0) });
      target.temperatureC.push({ timestamp, value: Number(cpu.temperatureC ?? 0) });
    }
  }
  return [...grouped.values()];
}

function buildDiskMetricSeries(points: TimeSeriesRecord[]): DiskMetricSeries[] {
  const grouped = new Map<string, DiskMetricSeries>();
  for (const point of points) {
    for (const disk of point.disks ?? []) {
      if (!grouped.has(disk.id)) {
        grouped.set(disk.id, {
          id: disk.id,
          name: disk.name,
          mountPoint: disk.mountPoint ?? "",
          filesystem: disk.filesystem,
          model: disk.model,
          vendor: disk.vendor,
          usagePercent: [],
          usedBytes: [],
          readBytesPerSec: [],
          writeBytesPerSec: [],
          temperatureC: []
        });
      }
      const target = grouped.get(disk.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      target.usagePercent.push({ timestamp, value: Number(disk.usagePercent ?? 0) });
      target.usedBytes.push({ timestamp, value: Number(disk.usedBytes ?? 0) });
      target.readBytesPerSec.push({ timestamp, value: Number(disk.readBytesPerSec ?? 0) });
      target.writeBytesPerSec.push({ timestamp, value: Number(disk.writeBytesPerSec ?? 0) });
      target.temperatureC.push({ timestamp, value: Number(disk.temperatureC ?? 0) });
    }
  }
  return [...grouped.values()];
}

function buildNetworkMetricSeries(points: TimeSeriesRecord[]): NetworkMetricSeries[] {
  const grouped = new Map<string, NetworkMetricSeries>();
  const rawTraffic = new Map<string, { rx: number[]; tx: number[] }>();

  for (const point of points) {
    for (const network of point.networks ?? []) {
      if (!grouped.has(network.id)) {
        grouped.set(network.id, {
          id: network.id,
          name: network.name,
          macAddress: network.macAddress,
          ipv4: network.ipv4,
          ipv6: network.ipv6,
          rxBytesPerSec: [],
          txBytesPerSec: [],
          trafficRxBytes: [],
          trafficTxBytes: []
        });
      }
      const target = grouped.get(network.id)!;
      const timestamp = new Date(point.timestamp).toISOString();
      target.rxBytesPerSec.push({ timestamp, value: Number(network.rxBytesPerSec ?? 0) });
      target.txBytesPerSec.push({ timestamp, value: Number(network.txBytesPerSec ?? 0) });
      target.trafficRxBytes.push({ timestamp, value: Number(network.trafficRxBytes ?? 0) });
      target.trafficTxBytes.push({ timestamp, value: Number(network.trafficTxBytes ?? 0) });

      rawTraffic.set(network.id, {
        rx: [...(rawTraffic.get(network.id)?.rx ?? []), Number(network.trafficRxBytes ?? 0)],
        tx: [...(rawTraffic.get(network.id)?.tx ?? []), Number(network.trafficTxBytes ?? 0)]
      });
    }
  }

  for (const [networkId, traffic] of rawTraffic.entries()) {
    const target = grouped.get(networkId);
    if (!target) continue;
    const normalizedRx = normalizeTrafficSeries(traffic.rx);
    const normalizedTx = normalizeTrafficSeries(traffic.tx);
    target.trafficRxBytes = target.trafficRxBytes.map((point, index) => ({ ...point, value: normalizedRx[index] ?? 0 }));
    target.trafficTxBytes = target.trafficTxBytes.map((point, index) => ({ ...point, value: normalizedTx[index] ?? 0 }));
  }

  return [...grouped.values()];
}

function buildGpuMetricSeries(points: TimeSeriesRecord[]): GpuMetricSeries[] {
  const grouped = new Map<string, GpuMetricSeries>();
  for (const point of points) {
    for (const gpu of point.gpus ?? []) {
      if (!grouped.has(gpu.id)) {
        grouped.set(gpu.id, {
          id: gpu.id,
          name: gpu.name,
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
      target.usagePercent.push({ timestamp, value: Number(gpu.usagePercent ?? 0) });
      target.encodePercent.push({ timestamp, value: Number(gpu.encodePercent ?? 0) });
      target.decodePercent.push({ timestamp, value: Number(gpu.decodePercent ?? 0) });
      target.frequencyMHz.push({ timestamp, value: Number(gpu.frequencyMHz ?? 0) });
      target.memoryUsagePercent.push({ timestamp, value: Number(gpu.memoryUsagePercent ?? 0) });
      target.memoryUsedBytes.push({ timestamp, value: Number(gpu.memoryUsedBytes ?? 0) });
      target.temperatureC.push({ timestamp, value: Number(gpu.temperatureC ?? 0) });
    }
  }
  return [...grouped.values()];
}

function buildFanMetricSeries(points: TimeSeriesRecord[]): FanMetricSeries[] {
  const grouped = new Map<string, FanMetricSeries>();
  for (const point of points) {
    for (const fan of point.fans ?? []) {
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

export function getAvailableMetrics(state: DeviceRealtimeState): DeviceMetricOption[] {
  const latest = state.latest;
  const hasGpu = latest.gpus.length > 0;
  const hasGpuFrequency = latest.gpus.some((gpu) => gpu.frequencyMHz != null);
  const hasGpuEncode = latest.gpus.some((gpu) => gpu.encodeUtilizationPercent != null);
  const hasGpuDecode = latest.gpus.some((gpu) => gpu.decodeUtilizationPercent != null);
  const hasGpuTemperature = latest.gpus.some((gpu) => gpu.temperatureC != null);
  const hasSwap = latest.memory.swapTotalBytes > 0 || latest.memory.swapUsedBytes > 0;
  const hasCpuFrequency =
    (latest.cpuFrequencyMHz ?? 0) > 0 || (latest.cpuPackages ?? []).some((cpu) => (cpu.frequencyMHz ?? 0) > 0);
  const hasCpuTemperature =
    latest.cpuTemperatureC != null || (latest.cpuPackages ?? []).some((cpu) => cpu.temperatureC != null);
  const hasDisks = latest.diskUsage.totalBytes > 0 || (latest.disks?.length ?? 0) > 0;
  const hasNetworkInterfaces = (latest.networkInterfaces?.length ?? 0) > 0;

  const availability = new Map<DeviceMetricKey, boolean>([
    ["cpuUsage", true],
    ["cpuFrequency", hasCpuFrequency],
    ["cpuTemperature", hasCpuTemperature],
    ["gpuUsage", hasGpu],
    ["gpuEncode", hasGpuEncode],
    ["gpuDecode", hasGpuDecode],
    ["gpuFrequency", hasGpuFrequency],
    ["gpuMemory", hasGpu],
    ["gpuTemperature", hasGpuTemperature],
    ["memoryUsage", latest.memory.totalBytes > 0],
    ["swapUsage", hasSwap],
    ["diskUsage", hasDisks],
    ["diskRead", true],
    ["diskWrite", true],
    ["networkRxRate", hasNetworkInterfaces],
    ["networkTxRate", hasNetworkInterfaces],
    ["networkTraffic", hasNetworkInterfaces]
  ]);

  return ALL_DEVICE_METRIC_KEYS.map((key) => ({
    key,
    available: availability.get(key) ?? false
  }));
}
