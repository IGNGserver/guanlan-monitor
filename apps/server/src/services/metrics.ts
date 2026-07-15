import type { AgentMetricsPayload, DeviceMetricConfigPayload, DeviceMetricKey, DeviceRealtimeEvent, MetricWindow } from "@dsc/shared";
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

const LIVE_WINDOWS: AggregatedWindowConfig[] = [
  { bucket: "1m", maxPoints: 12 },
  { bucket: "15m", maxPoints: 15 }
];

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MINUTE_WINDOW_MS = 60 * 1000;

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
    await this.repositories.realtime.appendSeries(payload.identity.deviceId, "1m", point, 12);
    await this.addMinuteAggregate(payload.identity.deviceId, point);
    await this.addHourlyAggregate(payload.identity.deviceId, point);

    const event: DeviceRealtimeEvent = {
      deviceId: payload.identity.deviceId,
      summary: toSummary(state),
      latest: payload
    };
    this.emitDeviceEvent(event);
  }

  async markOfflineDevices() {
    const devices = await this.repositories.realtime.listDevices();
    const now = Date.now();

    await Promise.all(
      devices.map(async (device) => {
        if (device.status === "offline") return;
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
    if (window === "1m" || window === "15m") {
      return this.repositories.realtime.readSeries(deviceId, window);
    }
    const history = await this.repositories.history.getHistoricalSeries(deviceId, window);
    if (window === "1d") {
      return this.withCurrentMinuteAggregate(deviceId, history);
    }
    return this.withCurrentHourlyAggregate(deviceId, history);
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
    current.samples.push(point);
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
    current.samples.push(point);
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
    cpuTemperatureC: total.cpuTemperatureC / samples.length,
    gpuUsagePercent: total.gpuUsagePercent / samples.length,
    gpuEncodePercent: total.gpuEncodePercent / samples.length,
    gpuDecodePercent: total.gpuDecodePercent / samples.length,
    gpuFrequencyMHz: total.gpuFrequencyMHz / samples.length,
    gpuMemoryUsagePercent: total.gpuMemoryUsagePercent / samples.length,
    gpuTemperatureC: total.gpuTemperatureC / samples.length,
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
    fans
  };
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
          | "readBytesPerSec"
          | "writeBytesPerSec"
          | "rxBytesPerSec"
          | "txBytesPerSec"
          | "trafficRxBytes"
          | "trafficTxBytes"
          | "encodePercent"
          | "decodePercent"
          | "frequencyMHz"
          | "memoryUsagePercent"
          | "temperatureC"
          | "rpm"
        >
      >;
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
            macAddress: item.macAddress,
            ipv4: item.ipv4,
            ipv6: item.ipv6,
            coreCount: item.coreCount,
            logicalCount: item.logicalCount,
            mountPoint: item.mountPoint,
            filesystem: item.filesystem,
            model: item.model,
            vendor: item.vendor
          },
          sums: {
            usagePercent: 0,
            readBytesPerSec: 0,
            writeBytesPerSec: 0,
            rxBytesPerSec: 0,
            txBytesPerSec: 0,
            trafficRxBytes: 0,
            trafficTxBytes: 0,
            encodePercent: 0,
            decodePercent: 0,
            frequencyMHz: 0,
            memoryUsagePercent: 0,
            temperatureC: 0,
            rpm: 0
          }
        });
      }
      const current = grouped.get(item.id)!;
      current.count += 1;
      current.sums.usagePercent += item.usagePercent ?? 0;
      current.sums.readBytesPerSec += item.readBytesPerSec ?? 0;
      current.sums.writeBytesPerSec += item.writeBytesPerSec ?? 0;
      current.sums.rxBytesPerSec += item.rxBytesPerSec ?? 0;
      current.sums.txBytesPerSec += item.txBytesPerSec ?? 0;
      current.sums.trafficRxBytes = item.trafficRxBytes ?? current.sums.trafficRxBytes;
      current.sums.trafficTxBytes = item.trafficTxBytes ?? current.sums.trafficTxBytes;
      current.sums.encodePercent += item.encodePercent ?? 0;
      current.sums.decodePercent += item.decodePercent ?? 0;
      current.sums.frequencyMHz += item.frequencyMHz ?? 0;
      current.sums.memoryUsagePercent += item.memoryUsagePercent ?? 0;
      current.sums.temperatureC += item.temperatureC ?? 0;
      current.sums.rpm += item.rpm ?? 0;
    }
  }

  return [...grouped.values()].map(({ count, meta, sums }) => ({
    ...meta,
    usagePercent: sums.usagePercent / count,
    readBytesPerSec: sums.readBytesPerSec / count,
    writeBytesPerSec: sums.writeBytesPerSec / count,
    rxBytesPerSec: sums.rxBytesPerSec / count,
    txBytesPerSec: sums.txBytesPerSec / count,
    trafficRxBytes: sums.trafficRxBytes,
    trafficTxBytes: sums.trafficTxBytes,
    encodePercent: sums.encodePercent / count,
    decodePercent: sums.decodePercent / count,
    frequencyMHz: sums.frequencyMHz / count,
    memoryUsagePercent: sums.memoryUsagePercent / count,
    temperatureC: sums.temperatureC / count,
    rpm: sums.rpm / count
  }));
}
