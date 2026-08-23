import type { AgentMetricsPayload, DeviceMetricConfigPayload, DeviceMetricKey, DeviceRealtimeEvent, MetricWindow, TemperatureSensorReading } from "@dsc/shared";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type {
  AggregatedWindowConfig,
  DeviceMetricConfigValue,
  DeviceMetricConfigStore,
  DeviceEventEmitter,
  DeviceRealtimeState,
  InstanceMetricRecord,
  MetricAccumulator,
  Repositories
} from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";
import { ALL_DEVICE_METRIC_KEYS, HEARTBEAT_TIMEOUT_MS, payloadToTimeSeries, toSummary } from "../utils.js";
import {
  buildVirtualMachinePayload,
  virtualMachineExternalId,
  virtualMachineId,
  virtualMachineScopeKey
} from "./virtual-machines.js";

const LIVE_WINDOWS: AggregatedWindowConfig[] = [
  { bucket: "1m", maxPoints: 30 },
  { bucket: "5m", maxPoints: 150 },
  { bucket: "15m", maxPoints: 15 }
];

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MINUTE_WINDOW_MS = 60 * 1000;
const LIVE_WINDOW_DURATION_MS = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000
} as const;

export class MetricsService {
  private readonly minuteAccumulators = new Map<string, MetricAccumulator>();
  private readonly hourlyAccumulators = new Map<string, MetricAccumulator>();

  constructor(
    private readonly repositories: Repositories,
    private readonly emitDeviceEvent: DeviceEventEmitter,
    private readonly deviceMetricConfigs: DeviceMetricConfigStore
  ) {}

  async ingest(payload: AgentMetricsPayload) {
    const receivedAt = new Date().toISOString();
    await this.repositories.devices.registerOrUpdateDevice(payload.identity.deviceId, payload.identity.hostname);
    await this.persistPayload(payload, receivedAt);
    await this.ingestVirtualMachines(payload);
  }

  private async persistPayload(
    payload: AgentMetricsPayload,
    receivedAt = new Date().toISOString(),
    sortOrder?: number
  ) {
    const previousState = await this.repositories.realtime.getDevice(payload.identity.deviceId);
    if (previousState && hasIdentityBoundaryChanged(previousState.identity, payload.identity)) {
      await this.resetDeviceSeries(payload.identity.deviceId);
    }
    const state: DeviceRealtimeState = {
      identity: payload.identity,
      status: "online",
      lastSeenAt: receivedAt,
      latest: payload
    };

    await this.repositories.realtime.upsert(state);

    const config = await this.getMetricConfig(payload.identity.deviceId);
    const point = payloadToTimeSeries(payload, config);
    await this.repositories.realtime.appendSeries(payload.identity.deviceId, "1m", point, 30);
    await this.repositories.realtime.appendSeries(payload.identity.deviceId, "5m", point, 150);
    await this.addMinuteAggregate(payload.identity.deviceId, point);
    await this.addHourlyAggregate(payload.identity.deviceId, point);

    const event: DeviceRealtimeEvent = {
      deviceId: payload.identity.deviceId,
      summary: {
        ...toSummary(state),
        ...(sortOrder === undefined ? {} : { sortOrder })
      },
      latest: payload
    };
    this.emitDeviceEvent(event);
  }

  private async ingestVirtualMachines(hostPayload: AgentMetricsPayload) {
    const snapshot = hostPayload.virtualization;
    if (!snapshot?.vms?.length) return;

    const scopeKey = virtualMachineScopeKey(snapshot, hostPayload.identity.deviceId);
    for (const vm of snapshot.vms) {
      const externalId = virtualMachineExternalId(vm);
      if (!externalId) continue;
      const proposedId = virtualMachineId(scopeKey, externalId);
      const record = await this.repositories.virtualMachines.registerOrUpdate({
        virtualMachineId: proposedId,
        scopeKey,
        externalId,
        platform: vm.platform || snapshot.platform,
        name: vm.name || externalId,
        hostDeviceId: hostPayload.identity.deviceId,
        hostName: hostPayload.identity.hostname,
        node: vm.node ?? null,
        type: vm.type ?? null,
        powerState: vm.powerState || "unknown",
        observedAt: new Date().toISOString()
      });
      await this.persistPayload(buildVirtualMachinePayload(hostPayload, record, vm), undefined, record.sortOrder);
    }
  }

  async markOfflineDevices() {
    const devices = await this.repositories.realtime.listDevices();
    const now = Date.now();
    const openVirtualMachineIds = new Set((await this.repositories.virtualMachines.listOpen()).map((item) => item.virtualMachineId));

    await Promise.all(
      devices.map(async (device) => {
        if (device.status === "offline") return;
        if (device.identity.instanceType === "virtual_machine" && !openVirtualMachineIds.has(device.identity.deviceId)) return;
        if (now - Date.parse(device.lastSeenAt) < HEARTBEAT_TIMEOUT_MS) return;
        const offlineState = { ...device, status: "offline" as const };
        await this.repositories.realtime.upsert(offlineState);
        this.emitDeviceEvent({
          deviceId: offlineState.identity.deviceId,
          summary: toSummary(offlineState),
          latest: offlineState.latest
        });
      })
    );
  }

  async getSeries(deviceId: string, window: MetricWindow) {
    if (window === "1m") {
      return this.readLiveSeries(deviceId, "1m");
    }
    if (window === "5m") {
      return this.readLiveSeries(deviceId, "5m");
    }
    if (window === "15m" || window === "1h" || window === "6h" || window === "24h" || window === "1d") {
      const history = await this.repositories.history.getHistoricalSeries(deviceId, window);
      return this.withCurrentMinuteAggregate(deviceId, history);
    }
    const history = await this.repositories.history.getHistoricalSeries(deviceId, window);
    return this.withCurrentHourlyAggregate(deviceId, history);
  }

  private async readLiveSeries(deviceId: string, window: "1m" | "5m") {
    const rangeStart = Date.now() - LIVE_WINDOW_DURATION_MS[window];
    const points = await this.repositories.realtime.readSeries(deviceId, window);
    return points.filter((point) => point.timestamp >= rangeStart);
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    const allHistoryPoints = await this.repositories.history.getHistoricalSeries(deviceId, "1y");
    const points = this.withCurrentMinuteAggregate(deviceId, this.withCurrentHourlyAggregate(deviceId, allHistoryPoints));
    return buildTrafficCalendar(points, mode, anchorDate, selectedStart);
  }

  async getEnabledMetrics(deviceId: string) {
    const configured = await this.deviceMetricConfigs.get(deviceId);
    if (configured == null) return ALL_DEVICE_METRIC_KEYS;
    return configured.enabledMetrics;
  }

  async getMetricConfig(deviceId: string): Promise<DeviceMetricConfigValue> {
    const configured = await this.deviceMetricConfigs.get(deviceId);
    if (configured == null) {
      return {
        enabledMetrics: ALL_DEVICE_METRIC_KEYS,
        enabledDeviceIds: {},
        instanceMetricConfig: {}
      };
    }
    return configured;
  }

  async setEnabledMetrics(deviceId: string, config: DeviceMetricConfigValue) {
    await this.deviceMetricConfigs.set(deviceId, config);
  }

  private async addMinuteAggregate(deviceId: string, point: ReturnType<typeof payloadToTimeSeries>) {
    const bucketStartedAt = Math.floor(point.timestamp / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
    const current = this.minuteAccumulators.get(deviceId);
    if (!current || current.bucketStartedAt !== bucketStartedAt) {
      if (current?.samples.length) {
        const aggregate = averageRecord(current.samples, current.bucketStartedAt);
        await this.repositories.history.insertMinutePoint(deviceId, aggregate);
        await this.flushAggregate(deviceId, "15m", current.samples, 15);
      }
      this.minuteAccumulators.set(deviceId, { bucketStartedAt, samples: [point] });
      return;
    }
    const existingIndex = current.samples.findIndex((sample) => sample.timestamp === point.timestamp);
    if (existingIndex >= 0) {
      current.samples[existingIndex] = point;
    } else {
      current.samples.push(point);
    }
  }

  private async addHourlyAggregate(deviceId: string, point: ReturnType<typeof payloadToTimeSeries>) {
    const bucketStartedAt = Math.floor(point.timestamp / HOURLY_WINDOW_MS) * HOURLY_WINDOW_MS;
    const current = this.hourlyAccumulators.get(deviceId);
    if (!current || current.bucketStartedAt !== bucketStartedAt) {
      if (current?.samples.length) {
        const aggregate = averageRecord(current.samples, current.bucketStartedAt);
        await this.repositories.history.insertHourlyPoint(deviceId, aggregate);
      }
      this.hourlyAccumulators.set(deviceId, { bucketStartedAt, samples: [point] });
      return;
    }
    const existingIndex = current.samples.findIndex((sample) => sample.timestamp === point.timestamp);
    if (existingIndex >= 0) {
      current.samples[existingIndex] = point;
    } else {
      current.samples.push(point);
    }
  }

  private async flushAggregate(deviceId: string, bucket: MetricWindow, samples: ReturnType<typeof payloadToTimeSeries>[], maxPoints: number) {
    const bucketStartedAt =
      bucket === "15m"
        ? Math.floor((samples[samples.length - 1]?.timestamp ?? Date.now()) / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS
        : Math.floor((samples[samples.length - 1]?.timestamp ?? Date.now()) / HOURLY_WINDOW_MS) * HOURLY_WINDOW_MS;
    const aggregate = averageRecord(samples, bucketStartedAt);
    await this.repositories.realtime.appendSeries(deviceId, bucket, aggregate, maxPoints);
  }

  private withCurrentHourlyAggregate(deviceId: string, history: ReturnType<typeof payloadToTimeSeries>[]) {
    const current = this.hourlyAccumulators.get(deviceId);
    if (!current?.samples.length) return history;

    const aggregate = averageRecord(current.samples, current.bucketStartedAt);
    const next = history.filter((point) => point.timestamp !== aggregate.timestamp);
    next.push(aggregate);
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  }

  private withCurrentMinuteAggregate(deviceId: string, history: ReturnType<typeof payloadToTimeSeries>[]) {
    const current = this.minuteAccumulators.get(deviceId);
    if (!current?.samples.length) return history;

    const aggregate = averageRecord(current.samples, current.bucketStartedAt);
    const next = history.filter((point) => point.timestamp !== aggregate.timestamp);
    next.push(aggregate);
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  }

  private async resetDeviceSeries(deviceId: string) {
    this.minuteAccumulators.delete(deviceId);
    this.hourlyAccumulators.delete(deviceId);
    await this.repositories.realtime.clearSeries(deviceId);
    await this.repositories.history.clearDeviceHistory(deviceId);
  }
}

function hasIdentityBoundaryChanged(previous: AgentMetricsPayload["identity"], next: AgentMetricsPayload["identity"]) {
  return (
    previous.os !== next.os ||
    previous.platform !== next.platform ||
    previous.arch !== next.arch ||
    previous.hostname !== next.hostname
  );
}

function averageRecord(samples: ReturnType<typeof payloadToTimeSeries>[], timestamp = samples[samples.length - 1]?.timestamp ?? Date.now()) {
  const lastSample = samples[samples.length - 1];
  const recordedDetails = lastSample?.recordedDetails;
  const temperatureSensors = mergeTemperatureSensorDetails(samples);
  const total = samples.reduce(
    (acc, sample) => ({
      timestamp,
      cpuUsagePercent: acc.cpuUsagePercent + sample.cpuUsagePercent,
      cpuFrequencyMHz: acc.cpuFrequencyMHz + sample.cpuFrequencyMHz,
      cpuTemperatureC: acc.cpuTemperatureC + sample.cpuTemperatureC,
      gpuUsagePercent: acc.gpuUsagePercent + sample.gpuUsagePercent,
      gpuEncodePercent: acc.gpuEncodePercent + sample.gpuEncodePercent,
      gpuDecodePercent: acc.gpuDecodePercent + sample.gpuDecodePercent,
      gpuFrequencyMHz: acc.gpuFrequencyMHz + sample.gpuFrequencyMHz,
      gpuMemoryUsagePercent: acc.gpuMemoryUsagePercent + sample.gpuMemoryUsagePercent,
      gpuTemperatureC: acc.gpuTemperatureC + sample.gpuTemperatureC,
      memoryUsagePercent: acc.memoryUsagePercent + sample.memoryUsagePercent,
      swapUsagePercent: acc.swapUsagePercent + sample.swapUsagePercent,
      memoryUsedBytes: acc.memoryUsedBytes + sample.memoryUsedBytes,
      swapUsedBytes: acc.swapUsedBytes + sample.swapUsedBytes,
      diskUsagePercent: acc.diskUsagePercent + sample.diskUsagePercent,
      diskUsedBytes: acc.diskUsedBytes + sample.diskUsedBytes,
      diskReadBytesPerSec: acc.diskReadBytesPerSec + sample.diskReadBytesPerSec,
      diskWriteBytesPerSec: acc.diskWriteBytesPerSec + sample.diskWriteBytesPerSec,
      networkRxBytesPerSec: acc.networkRxBytesPerSec + sample.networkRxBytesPerSec,
      networkTxBytesPerSec: acc.networkTxBytesPerSec + sample.networkTxBytesPerSec,
      trafficRxBytes: acc.trafficRxBytes + sample.trafficRxBytes,
      trafficTxBytes: acc.trafficTxBytes + sample.trafficTxBytes,
      cpus: acc.cpus,
      disks: acc.disks,
      networks: acc.networks,
      gpus: acc.gpus,
      fans: acc.fans
    }),
    {
      timestamp,
      cpuUsagePercent: 0,
      cpuFrequencyMHz: 0,
      cpuTemperatureC: 0,
      gpuUsagePercent: 0,
      gpuEncodePercent: 0,
      gpuDecodePercent: 0,
      gpuFrequencyMHz: 0,
      gpuMemoryUsagePercent: 0,
      gpuTemperatureC: 0,
      memoryUsagePercent: 0,
      swapUsagePercent: 0,
      memoryUsedBytes: 0,
      swapUsedBytes: 0,
      diskUsagePercent: 0,
      diskUsedBytes: 0,
      diskReadBytesPerSec: 0,
      diskWriteBytesPerSec: 0,
      networkRxBytesPerSec: 0,
      networkTxBytesPerSec: 0,
      trafficRxBytes: 0,
      trafficTxBytes: 0,
      cpus: [] as InstanceMetricRecord[],
      disks: [] as InstanceMetricRecord[],
      networks: [] as InstanceMetricRecord[],
      gpus: [] as InstanceMetricRecord[],
      fans: [] as InstanceMetricRecord[]
    }
  );

  const cpus = averageInstanceMetrics(samples, "cpus");
  const disks = averageInstanceMetrics(samples, "disks");
  const networks = averageInstanceMetrics(samples, "networks");
  const gpus = averageInstanceMetrics(samples, "gpus");
  const fans = averageInstanceMetrics(samples, "fans");

  return {
    timestamp: total.timestamp,
    cpuUsagePercent: total.cpuUsagePercent / samples.length,
    cpuFrequencyMHz: total.cpuFrequencyMHz / samples.length,
    cpuTemperatureC: averagePositiveTemperature(samples.map((sample) => sample.cpuTemperatureC)),
    gpuUsagePercent: total.gpuUsagePercent / samples.length,
    gpuEncodePercent: total.gpuEncodePercent / samples.length,
    gpuDecodePercent: total.gpuDecodePercent / samples.length,
    gpuFrequencyMHz: total.gpuFrequencyMHz / samples.length,
    gpuMemoryUsagePercent: total.gpuMemoryUsagePercent / samples.length,
    gpuTemperatureC: averagePositiveTemperature(samples.map((sample) => sample.gpuTemperatureC)),
    memoryUsagePercent: total.memoryUsagePercent / samples.length,
    swapUsagePercent: total.swapUsagePercent / samples.length,
    memoryUsedBytes: total.memoryUsedBytes / samples.length,
    swapUsedBytes: total.swapUsedBytes / samples.length,
    diskUsagePercent: total.diskUsagePercent / samples.length,
    diskUsedBytes: total.diskUsedBytes / samples.length,
    diskReadBytesPerSec: total.diskReadBytesPerSec / samples.length,
    diskWriteBytesPerSec: total.diskWriteBytesPerSec / samples.length,
    networkRxBytesPerSec: total.networkRxBytesPerSec / samples.length,
    networkTxBytesPerSec: total.networkTxBytesPerSec / samples.length,
    trafficRxBytes: lastSample?.trafficRxBytes ?? 0,
    trafficTxBytes: lastSample?.trafficTxBytes ?? 0,
    cpus,
    disks,
    networks,
    gpus,
    fans,
    recordedDetails: recordedDetails
      ? {
          ...recordedDetails,
          temperatureSensors
        }
      : undefined
  };
}

function averagePositiveTemperature(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function mergeTemperatureSensorDetails(samples: ReturnType<typeof payloadToTimeSeries>[]): TemperatureSensorReading[] {
  const sensors = new Map<string, TemperatureSensorReading>();
  for (const sample of samples) {
    for (const sensor of sample.recordedDetails?.temperatureSensors ?? []) {
      sensors.set(sensor.id, sensor);
    }
  }
  return [...sensors.values()];
}

function averageInstanceMetrics(
  samples: ReturnType<typeof payloadToTimeSeries>[],
  key: "cpus" | "disks" | "networks" | "gpus" | "fans"
): InstanceMetricRecord[] {
  const grouped = new Map<
    string,
    {
      count: number;
      meta: InstanceMetricRecord;
      sums: Required<
        Pick<
          InstanceMetricRecord,
          | "usagePercent"
          | "totalBytes"
          | "usedBytes"
          | "readBytesPerSec"
          | "writeBytesPerSec"
          | "activePercent"
          | "rxBytesPerSec"
          | "txBytesPerSec"
          | "trafficRxBytes"
          | "trafficTxBytes"
          | "encodePercent"
          | "decodePercent"
          | "frequencyMHz"
          | "memoryUsagePercent"
          | "memoryUsedBytes"
          | "rpm"
        >
      >;
      temperatureSum: number;
      temperatureCount: number;
    }
  >();

  for (const sample of samples) {
    for (const item of sample[key] ?? []) {
      if (!grouped.has(item.id)) {
        grouped.set(item.id, {
          count: 0,
          meta: {
            id: item.id,
            name: item.name,
            integrated: item.integrated,
            memoryKind: item.memoryKind,
            macAddress: item.macAddress,
            ipv4: item.ipv4,
            ipv6: item.ipv6,
            coreCount: item.coreCount,
            logicalCount: item.logicalCount,
            l3CacheBytes: item.l3CacheBytes,
            mountPoint: item.mountPoint,
            filesystem: item.filesystem,
            model: item.model,
            vendor: item.vendor,
            physicalDevice: item.physicalDevice,
            totalBytes: item.totalBytes
          },
          sums: {
            usagePercent: 0,
            totalBytes: 0,
            usedBytes: 0,
            readBytesPerSec: 0,
            writeBytesPerSec: 0,
            activePercent: 0,
            rxBytesPerSec: 0,
            txBytesPerSec: 0,
            trafficRxBytes: 0,
            trafficTxBytes: 0,
            encodePercent: 0,
            decodePercent: 0,
            frequencyMHz: 0,
            memoryUsagePercent: 0,
            memoryUsedBytes: 0,
            rpm: 0
          },
          temperatureSum: 0,
          temperatureCount: 0
        });
      }
      const current = grouped.get(item.id)!;
      current.count += 1;
      if (item.integrated) current.meta.integrated = true;
      if ((!current.meta.memoryKind || current.meta.memoryKind === "unknown") && item.memoryKind) {
        current.meta.memoryKind = item.memoryKind;
      }
      if (!current.meta.physicalDevice && item.physicalDevice) {
        current.meta.physicalDevice = item.physicalDevice;
      }
      if (item.temperatureSource === "cpuPackageShared" || (!current.meta.temperatureSource && item.temperatureSource)) {
        current.meta.temperatureSource = item.temperatureSource;
      }
      current.sums.usagePercent += item.usagePercent ?? 0;
      current.sums.totalBytes += item.totalBytes ?? 0;
      current.sums.usedBytes += item.usedBytes ?? 0;
      current.sums.readBytesPerSec += item.readBytesPerSec ?? 0;
      current.sums.writeBytesPerSec += item.writeBytesPerSec ?? 0;
      current.sums.activePercent += item.activePercent ?? 0;
      current.sums.rxBytesPerSec += item.rxBytesPerSec ?? 0;
      current.sums.txBytesPerSec += item.txBytesPerSec ?? 0;
      current.sums.trafficRxBytes = item.trafficRxBytes ?? current.sums.trafficRxBytes;
      current.sums.trafficTxBytes = item.trafficTxBytes ?? current.sums.trafficTxBytes;
      current.sums.encodePercent += item.encodePercent ?? 0;
      current.sums.decodePercent += item.decodePercent ?? 0;
      current.sums.frequencyMHz += item.frequencyMHz ?? 0;
      current.sums.memoryUsagePercent += item.memoryUsagePercent ?? 0;
      current.sums.memoryUsedBytes += item.memoryUsedBytes ?? 0;
      if (typeof item.temperatureC === "number" && Number.isFinite(item.temperatureC) && item.temperatureC > 0) {
        current.temperatureSum += item.temperatureC;
        current.temperatureCount += 1;
      }
      current.sums.rpm += item.rpm ?? 0;
    }
  }

  return [...grouped.values()].map(({ count, meta, sums, temperatureSum, temperatureCount }) => ({
    ...meta,
    usagePercent: sums.usagePercent / count,
    totalBytes: sums.totalBytes / count,
    usedBytes: sums.usedBytes / count,
    readBytesPerSec: sums.readBytesPerSec / count,
    writeBytesPerSec: sums.writeBytesPerSec / count,
    activePercent: sums.activePercent / samples.length,
    // An instance absent from an aggregated sample contributes zero. Dividing
    // by the number of samples keeps one active NIC from being copied onto
    // interfaces that were idle or missing in the same window.
    rxBytesPerSec: sums.rxBytesPerSec / samples.length,
    txBytesPerSec: sums.txBytesPerSec / samples.length,
    trafficRxBytes: sums.trafficRxBytes,
    trafficTxBytes: sums.trafficTxBytes,
    encodePercent: sums.encodePercent / count,
    decodePercent: sums.decodePercent / count,
    frequencyMHz: sums.frequencyMHz / count,
    memoryUsagePercent: sums.memoryUsagePercent / count,
    memoryUsedBytes: sums.memoryUsedBytes / count,
    temperatureC: temperatureCount > 0 ? temperatureSum / temperatureCount : undefined,
    rpm: sums.rpm / count
  }));
}
