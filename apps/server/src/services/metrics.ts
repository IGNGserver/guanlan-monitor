import type { AgentMetricsPayload, DeviceMetricConfigPayload, DeviceMetricKey, DeviceRealtimeEvent, MetricWindow, TemperatureSensorReading } from "@dsc/shared";
import type { TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type {
  DeviceMetricConfigValue,
  DeviceMetricConfigStore,
  DeviceEventEmitter,
  DeviceRealtimeState,
  InstanceMetricRecord,
  MetricAccumulator,
  Repositories
} from "../types.js";
import { buildTrafficCalendar, trafficCalendarBounds } from "../traffic-calendar.js";
import { ALL_DEVICE_METRIC_KEYS, HEARTBEAT_TIMEOUT_MS, payloadToTimeSeries, toSummary } from "../utils.js";
import { forEachBounded, KeyedSerialQueue } from "../serial-queue.js";
import { nonOverlappingTask } from "../lifecycle.js";
import { projectOverviewRecord } from "../overview.js";
import { SharedQueryWork } from "../query-work.js";
import { AggregateSnapshots } from "../aggregate-snapshots.js";

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const MINUTE_WINDOW_MS = 60 * 1000;
const MAX_MINUTE_SAMPLES = 256;
const MAX_HOURLY_SAMPLES = 4_096;
const LIVE_WINDOW_DURATION_MS = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000
} as const;

export class MetricsService {
  private readonly aggregateSnapshots = new AggregateSnapshots(averageRecord);
  private readonly queryWork = new SharedQueryWork();
  private readonly minuteAccumulators = new Map<string, MetricAccumulator>();
  private readonly hourlyAccumulators = new Map<string, MetricAccumulator>();
  private readonly dirtyAccumulators = new WeakSet<MetricAccumulator>();
  private readonly deviceQueues = new KeyedSerialQueue();
  private readonly ingestQueues = new KeyedSerialQueue();
  private readonly flushTask = nonOverlappingTask(() => this.performAggregateFlush());
  private readonly offlineTask = nonOverlappingTask(() => this.performOfflineScan());

  constructor(
    private readonly repositories: Repositories,
    private readonly emitDeviceEvent: DeviceEventEmitter,
    private readonly deviceMetricConfigs: DeviceMetricConfigStore
  ) {}

  async ingest(payload: AgentMetricsPayload) {
    const receivedAt = new Date().toISOString();
    await this.runDeviceIngestOperation(payload.identity.deviceId, () => this.runDeviceAggregateOperation(payload.identity.deviceId, async () => {
      const device = await this.repositories.devices.registerOrUpdateDevice(
        payload.identity.deviceId,
        payload.identity.hostname,
        { reopenClosed: true, skipUnchanged: true }
      );
      if (device.status === "closed") return;
      await this.persistPayload(payload, receivedAt, device.sortOrder, device.group ?? null);
    }));
  }

  private async persistPayload(
    payload: AgentMetricsPayload,
    receivedAt = new Date().toISOString(),
    sortOrder?: number,
    group?: string | null
  ) {
    const previousState = await this.repositories.realtime.getDevice(payload.identity.deviceId);
    // An offline agent may replay an older pending sample after a newer one
    // already reached the Hub. Never let it replace the live reading or roll
    // the active aggregation window backwards.
    if (previousState && Date.parse(payload.timestamp) <= Date.parse(previousState.latest.timestamp)) {
      return;
    }
    if (previousState && hasIdentityBoundaryChanged(previousState.identity, payload.identity)) {
      // Identity metadata changed (e.g. hostname, os, platform, arch).
      // Preserve historical metrics in history repository, and reset only live accumulators.
      this.minuteAccumulators.delete(payload.identity.deviceId);
      this.hourlyAccumulators.delete(payload.identity.deviceId);
    }
    const state: DeviceRealtimeState = {
      identity: payload.identity,
      status: "online",
      lastSeenAt: receivedAt,
      latest: payload
    };

    const config = await this.getMetricConfig(payload.identity.deviceId);
    const point = payloadToTimeSeries(payload, config);
    await this.repositories.realtime.appendSeries(payload.identity.deviceId, "1m", point, 30);
    await this.repositories.realtime.appendSeries(payload.identity.deviceId, "5m", point, 150);
    await this.addMinuteAggregate(payload.identity.deviceId, point);
    await this.addHourlyAggregate(payload.identity.deviceId, point);
    // Publish the accepted timestamp only after all required stages succeed.
    // Otherwise an append/history error followed by retry hits the stale-sample
    // fast exit and falsely acknowledges work that never reached aggregation.
    await this.repositories.realtime.upsert(state);

    const event: DeviceRealtimeEvent = {
      deviceId: payload.identity.deviceId,
      summary: {
        ...toSummary(state),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        ...(group === undefined ? {} : { group })
      }
    };
    this.emitDeviceEvent(event);
  }

  async removeDevice(deviceId: string, revokeLive?: () => Promise<void>) {
    return this.runDeviceIngestOperation(deviceId, () => this.runDeviceAggregateOperation(deviceId,
      () => this.performRemoveDevice(deviceId, revokeLive)));
  }

  private async performRemoveDevice(deviceId: string, revokeLive?: () => Promise<void>) {
    await revokeLive?.();
    await this.repositories.devices.deleteDevice(deviceId);
    const state = await this.repositories.realtime.getDevice(deviceId);
    this.minuteAccumulators.delete(deviceId);
    this.hourlyAccumulators.delete(deviceId);
    await this.repositories.realtime.remove(deviceId);
    if (!state) return;

    const offlineState = { ...state, status: "offline" as const };
    this.emitDeviceEvent({
      deviceId,
      summary: toSummary(offlineState),
      removed: true
    });
  }

  markOfflineDevices(): Promise<void> {
    return this.offlineTask();
  }

  private async performOfflineScan() {
    const now = Date.now();
    const scanBatch = (devices: DeviceRealtimeState[]) => forEachBounded(devices, async (device) => {
      if (device.status === "offline") return;
      if (now - Date.parse(device.lastSeenAt) < HEARTBEAT_TIMEOUT_MS) return;
      const offlineState = { ...device, status: "offline" as const };
      const marked = await this.repositories.realtime.markOfflineIfMatch(
        device.identity.deviceId,
        device.lastSeenAt,
        offlineState
      );
      if (marked) {
        this.emitDeviceEvent({
          deviceId: offlineState.identity.deviceId,
          summary: toSummary(offlineState)
        });
      }
    });
    if (!this.repositories.realtime.listExpiredDevices) {
      await scanBatch(await this.repositories.realtime.listDevices());
      return;
    }
    // Drain bounded pages in this sweep, not one page per five-second tick:
    // the number of devices must not add artificial offline-detection delay.
    for (;;) {
      const devices = await this.repositories.realtime.listExpiredDevices(now - HEARTBEAT_TIMEOUT_MS);
      if (!devices.length) return;
      await scanBatch(devices);
    }
  }

  async getSeries(deviceId: string, window: MetricWindow) {
    if (window === "1m") {
      return this.readLiveSeries(deviceId, "1m");
    }
    if (window === "5m") {
      return this.readLiveSeries(deviceId, "5m");
    }
    if (window === "15m" || window === "1h" || window === "6h" || window === "24h" || window === "1d") {
      const history = await this.queryWork.run(JSON.stringify(["history", deviceId, window]),
        () => this.repositories.history.getHistoricalSeries(deviceId, window));
      return this.withCurrentMinuteAggregate(deviceId, history);
    }
    const history = await this.queryWork.run(JSON.stringify(["history", deviceId, window]),
      () => this.repositories.history.getHistoricalSeries(deviceId, window));
    return this.withCurrentHourlyAggregate(deviceId, history);
  }

  async getOverviewSeries(deviceId: string, window: MetricWindow) {
    if (window === "1m" || window === "5m" || !this.repositories.history.getOverviewSeries) {
      return (await this.getSeries(deviceId, window)).map(projectOverviewRecord);
    }
    const history = await this.queryWork.run(JSON.stringify(["overview", deviceId, window]),
      () => this.repositories.history.getOverviewSeries!(deviceId, window));
    const minute = window === "15m" || window === "1h" || window === "6h" || window === "24h" || window === "1d";
    const current = (minute ? this.minuteAccumulators : this.hourlyAccumulators).get(deviceId);
    if (!current?.samples.length) return history;
    // Retain the exact existing aggregate/quality rules and current-bucket
    // replacement. Only the read projection changes, never stored history.
    const aggregate = projectOverviewRecord(this.aggregateSnapshots.read(current));
    const next = history.filter((point) => point.timestamp !== aggregate.timestamp);
    next.push(aggregate);
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  }

  private async readLiveSeries(deviceId: string, window: "1m" | "5m") {
    const rangeStart = Date.now() - LIVE_WINDOW_DURATION_MS[window];
    const points = await this.queryWork.run(JSON.stringify(["realtime", deviceId, window]),
      () => this.repositories.realtime.readSeries(deviceId, window));
    return points.filter((point) => point.timestamp >= rangeStart);
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    const { start, end } = trafficCalendarBounds(mode, anchorDate);
    let points = await this.queryWork.run(JSON.stringify(["traffic", deviceId, start, end]),
      () => this.repositories.history.getTrafficSeries(deviceId, start, end));
    // Traffic counters are the last observation of each aggregate, not its
    // average. Preserve the existing hour + minute overlay without building
    // or reading unrelated hardware/CPU/memory detail payloads.
    for (const aggregate of [this.hourlyAccumulators.get(deviceId), this.minuteAccumulators.get(deviceId)]) {
      const last = aggregate?.samples.at(-1);
      if (!aggregate || !last || aggregate.bucketStartedAt < start || aggregate.bucketStartedAt >= end) continue;
      points = points.filter((point) => point.timestamp !== aggregate.bucketStartedAt);
      points.push({ timestamp: aggregate.bucketStartedAt, trafficRxBytes: last.trafficRxBytes, trafficTxBytes: last.trafficTxBytes });
    }
    points.sort((a, b) => a.timestamp - b.timestamp);
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

  flushAggregates(): Promise<void> {
    return this.flushTask();
  }

  async flushAfterDrain(): Promise<void> {
    // An existing periodic flush may have captured its device set before the
    // last admitted request. Wait, then take a fresh snapshot after HTTP drain.
    await this.flushTask.drain().catch(() => undefined);
    await this.offlineTask.drain();
    await this.flushTask();
  }

  private async performAggregateFlush(): Promise<void> {
    const failures: unknown[] = [];
    const deviceIds = new Set([...this.minuteAccumulators.keys(), ...this.hourlyAccumulators.keys()]);
    await forEachBounded(deviceIds, (deviceId) =>
      this.runDeviceAggregateOperation(deviceId, async () => {
        const minAcc = this.minuteAccumulators.get(deviceId);
        if (minAcc?.samples.length && this.dirtyAccumulators.has(minAcc)) {
          try {
            await this.persistMinuteAccumulator(deviceId, minAcc);
          } catch (error) {
            failures.push(error);
          }
        }

        const hrAcc = this.hourlyAccumulators.get(deviceId);
        if (hrAcc?.samples.length && this.dirtyAccumulators.has(hrAcc)) {
          try {
            await this.persistHourlyAccumulator(deviceId, hrAcc);
          } catch (error) {
            failures.push(error);
          }
        }
      })
    );

    if (failures.length) throw new AggregateError(failures, "one or more metric aggregate flushes failed");
  }

  private async addMinuteAggregate(deviceId: string, point: ReturnType<typeof payloadToTimeSeries>) {
    const bucketStartedAt = Math.floor(point.timestamp / MINUTE_WINDOW_MS) * MINUTE_WINDOW_MS;
    const current = this.minuteAccumulators.get(deviceId);
    if (!current || current.bucketStartedAt !== bucketStartedAt) {
      if (current?.samples.length) {
        await this.persistMinuteAccumulator(deviceId, current);
      }
      const next = { bucketStartedAt, samples: [point] };
      this.minuteAccumulators.set(deviceId, next);
      this.dirtyAccumulators.add(next);
      return;
    }
    const existingIndex = current.samples.findIndex((sample) => sample.timestamp === point.timestamp);
    if (existingIndex >= 0) {
      current.samples[existingIndex] = point;
    } else {
      if (current.samples.length >= MAX_MINUTE_SAMPLES) current.samples.shift();
      current.samples.push(point);
    }
    this.aggregateSnapshots.invalidate(current);
    this.dirtyAccumulators.add(current);
  }

  private async addHourlyAggregate(deviceId: string, point: ReturnType<typeof payloadToTimeSeries>) {
    const bucketStartedAt = Math.floor(point.timestamp / HOURLY_WINDOW_MS) * HOURLY_WINDOW_MS;
    const current = this.hourlyAccumulators.get(deviceId);
    if (!current || current.bucketStartedAt !== bucketStartedAt) {
      if (current?.samples.length) {
        await this.persistHourlyAccumulator(deviceId, current);
      }
      const next = { bucketStartedAt, samples: [point] };
      this.hourlyAccumulators.set(deviceId, next);
      this.dirtyAccumulators.add(next);
      return;
    }
    const existingIndex = current.samples.findIndex((sample) => sample.timestamp === point.timestamp);
    if (existingIndex >= 0) {
      current.samples[existingIndex] = point;
    } else {
      if (current.samples.length >= MAX_HOURLY_SAMPLES) current.samples.shift();
      current.samples.push(point);
    }
    this.aggregateSnapshots.invalidate(current);
    this.dirtyAccumulators.add(current);
  }

  private async persistMinuteAccumulator(deviceId: string, current: MetricAccumulator) {
    if (!this.dirtyAccumulators.has(current)) return;
    await this.repositories.history.insertMinutePoint(deviceId, this.aggregateSnapshots.read(current));
    // Clear only after every required write succeeds, under the device lock.
    this.dirtyAccumulators.delete(current);
  }

  private async persistHourlyAccumulator(deviceId: string, current: MetricAccumulator) {
    if (!this.dirtyAccumulators.has(current)) return;
    await this.repositories.history.insertHourlyPoint(deviceId, this.aggregateSnapshots.read(current));
    this.dirtyAccumulators.delete(current);
  }

  private withCurrentHourlyAggregate(deviceId: string, history: ReturnType<typeof payloadToTimeSeries>[]) {
    const current = this.hourlyAccumulators.get(deviceId);
    if (!current?.samples.length) return history;

    const aggregate = this.aggregateSnapshots.read(current);
    const next = history.filter((point) => point.timestamp !== aggregate.timestamp);
    next.push(aggregate);
    next.sort((a, b) => a.timestamp - b.timestamp);
    return next;
  }

  private withCurrentMinuteAggregate(deviceId: string, history: ReturnType<typeof payloadToTimeSeries>[]) {
    const current = this.minuteAccumulators.get(deviceId);
    if (!current?.samples.length) return history;

    const aggregate = this.aggregateSnapshots.read(current);
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

  private runDeviceIngestOperation(deviceId: string, operation: () => Promise<void>): Promise<void> {
    return this.ingestQueues.run(deviceId, operation);
  }

  private runDeviceAggregateOperation<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    return this.deviceQueues.run(deviceId, operation);
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

export function averageRecord(samples: ReturnType<typeof payloadToTimeSeries>[], timestamp = samples[samples.length - 1]?.timestamp ?? Date.now()) {
  const lastSample = samples[samples.length - 1];
  const recordedDetails = lastSample?.recordedDetails;
  const metricQuality = { ...recordedDetails?.metricQuality };
  const unavailableMetrics = new Set(recordedDetails?.unavailableMetrics ?? []);
  // A bucket with a missing observation must not publish an average diluted
  // by its legacy numeric placeholder. Conservatively gap the affected metric
  // for that bucket while leaving complete metrics and old agents unchanged.
  for (const sample of samples) {
    const details = sample.recordedDetails;
    for (const [key, quality] of Object.entries(details?.metricQuality ?? {})) {
      if (quality.state === "unavailable" || quality.state === "not_applicable" || quality.state === "stale") {
        metricQuality[key as keyof typeof metricQuality] = { ...quality, reason: "aggregate contains missing or expired observations" };
        unavailableMetrics.add(key as keyof typeof metricQuality);
      }
    }
    for (const key of details?.unavailableMetrics ?? []) unavailableMetrics.add(key);
  }
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
    hardwareSampledAt: lastSample?.hardwareSampledAt,
    cpuTemperatureSampledAt: lastSample?.cpuTemperatureSampledAt,
    cpuUsagePercent: total.cpuUsagePercent / samples.length,
    cpuFrequencyMHz: total.cpuFrequencyMHz / samples.length,
    cpuTemperatureC: averageObservedTemperature(samples, "cpuTemperatureC", "cpuTemperatureSampledAt"),
    gpuUsagePercent: total.gpuUsagePercent / samples.length,
    gpuEncodePercent: total.gpuEncodePercent / samples.length,
    gpuDecodePercent: total.gpuDecodePercent / samples.length,
    gpuFrequencyMHz: total.gpuFrequencyMHz / samples.length,
    gpuMemoryUsagePercent: total.gpuMemoryUsagePercent / samples.length,
    gpuTemperatureC: averageObservedTemperature(samples, "gpuTemperatureC", "hardwareSampledAt"),
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
          metricQuality: Object.keys(metricQuality).length ? metricQuality : undefined,
          unavailableMetrics: unavailableMetrics.size ? [...unavailableMetrics] : undefined,
          aggregatedInstances: { cpus, networks, fans },
          temperatureSensors
        }
      : undefined,
    sampleCount: samples.length
  };
}

function averageObservedTemperature(
  samples: ReturnType<typeof payloadToTimeSeries>[],
  valueKey: "cpuTemperatureC" | "gpuTemperatureC",
  observedAtKey: "cpuTemperatureSampledAt" | "hardwareSampledAt"
): number {
  const values = new Map<string, number>();
  for (const sample of samples) {
    const value = sample[valueKey];
    if (Number.isFinite(value) && value > 0) {
      values.set(sample[observedAtKey] ?? String(sample.timestamp), value);
    }
  }
  return values.size ? [...values.values()].reduce((sum, value) => sum + value, 0) / values.size : 0;
}

function mergeTemperatureSensorDetails(samples: ReturnType<typeof payloadToTimeSeries>[]): TemperatureSensorReading[] {
  const sensors = new Map<string, TemperatureSensorReading>();
  const values = new Map<string, { readings: Map<string, number> }>();
  for (const sample of samples) {
    for (const sensor of sample.recordedDetails?.temperatureSensors ?? []) {
      sensors.set(sensor.id, sensor);
      if (sensor.status === "valid" && typeof sensor.currentC === "number" && Number.isFinite(sensor.currentC)) {
        const previous = values.get(sensor.id) ?? { readings: new Map<string, number>() };
        previous.readings.set(sensor.observedAt ?? sample.hardwareSampledAt ?? String(sample.timestamp), sensor.currentC);
        values.set(sensor.id, previous);
      }
    }
  }
  return [...sensors.values()].map((sensor) => {
    const measured = values.get(sensor.id);
    return measured && sensor.status === "valid"
      ? { ...sensor, currentC: [...measured.readings.values()].reduce((sum, value) => sum + value, 0) / measured.readings.size }
      : sensor;
  });
}

function averageInstanceMetrics(
  samples: ReturnType<typeof payloadToTimeSeries>[],
  key: "cpus" | "disks" | "networks" | "gpus" | "fans"
): InstanceMetricRecord[] {
  const grouped = new Map<
    string,
    {
      count: number;
      usageCount: number;
      frequencyCount: number;
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
      rpmCount: number;
      temperatureObservedAt: Set<string>;
      rpmObservedAt: Set<string>;
    }
  >();

  for (const sample of samples) {
    for (const item of sample[key] ?? []) {
      if (!grouped.has(item.id)) {
        grouped.set(item.id, {
          count: 0,
          usageCount: 0,
          frequencyCount: 0,
          meta: {
            id: item.id,
            name: item.name,
            socketIndex: item.socketIndex,
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
          temperatureCount: 0,
          rpmCount: 0,
          temperatureObservedAt: new Set<string>(),
          rpmObservedAt: new Set<string>()
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
      if (typeof item.usagePercent === "number" && Number.isFinite(item.usagePercent)) {
        current.sums.usagePercent += item.usagePercent;
        current.usageCount += 1;
      }
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
      if (typeof item.frequencyMHz === "number" && Number.isFinite(item.frequencyMHz) && item.frequencyMHz > 0) {
        current.sums.frequencyMHz += item.frequencyMHz;
        current.frequencyCount += 1;
      }
      current.sums.memoryUsagePercent += item.memoryUsagePercent ?? 0;
      current.sums.memoryUsedBytes += item.memoryUsedBytes ?? 0;
      const temperatureAt = key === "cpus" ? sample.cpuTemperatureSampledAt : sample.hardwareSampledAt;
      if (typeof item.temperatureC === "number" && Number.isFinite(item.temperatureC) && item.temperatureC > 0 &&
        (!temperatureAt || !current.temperatureObservedAt.has(temperatureAt))) {
        current.temperatureSum += item.temperatureC;
        current.temperatureCount += 1;
        if (temperatureAt) current.temperatureObservedAt.add(temperatureAt);
      }
      if (typeof item.rpm === "number" && Number.isFinite(item.rpm) &&
        (!sample.hardwareSampledAt || !current.rpmObservedAt.has(sample.hardwareSampledAt))) {
        current.sums.rpm += item.rpm;
        current.rpmCount += 1;
        if (sample.hardwareSampledAt) current.rpmObservedAt.add(sample.hardwareSampledAt);
      }
    }
  }

  return [...grouped.values()].map(({ count, usageCount, frequencyCount, meta, sums, temperatureSum, temperatureCount, rpmCount }) => ({
    ...meta,
    usagePercent: usageCount > 0 ? sums.usagePercent / usageCount : undefined,
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
    frequencyMHz: frequencyCount > 0 ? sums.frequencyMHz / frequencyCount : undefined,
    memoryUsagePercent: sums.memoryUsagePercent / count,
    memoryUsedBytes: sums.memoryUsedBytes / count,
    temperatureC: temperatureCount > 0 ? temperatureSum / temperatureCount : undefined,
    rpm: rpmCount > 0 ? sums.rpm / rpmCount : undefined
  }));
}
