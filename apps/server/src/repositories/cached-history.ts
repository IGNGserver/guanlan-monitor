import type {
  HistoryRepository,
  OverviewRecord,
  TimeSeriesRecord,
  TrafficHistoryPoint
} from "../types.js";
import type { MetricWindow, TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import { BoundedTtlCache, estimateBytes } from "../storage/cache.js";
import { projectOverviewRecord } from "../overview.js";

export interface SharedReadCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export interface CachedHistoryOptions {
  ttlMs: number;
  calendarTtlMs: number;
  maxEntries: number;
  maxBytes: number;
  shared?: SharedReadCache;
  onError?: (error: unknown) => void;
}

/** Read-through cache around the durable history repository. */
export class CachedHistoryRepository implements HistoryRepository {
  private readonly cache: BoundedTtlCache;
  private readonly epochs = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private lastSharedErrorAt = 0;

  constructor(
    private readonly inner: HistoryRepository,
    private readonly options: CachedHistoryOptions
  ) {
    this.cache = new BoundedTtlCache(options.maxEntries, options.maxBytes, Math.max(options.ttlMs, options.calendarTtlMs));
  }

  async checkReadiness(): Promise<void> {
    if (this.inner.checkReadiness) await this.inner.checkReadiness();
  }

  async insertMinutePoint(deviceId: string, point: TimeSeriesRecord) {
    await this.inner.insertMinutePoint(deviceId, point);
    this.bump(deviceId);
  }

  async insertHourlyPoint(deviceId: string, point: TimeSeriesRecord) {
    await this.inner.insertHourlyPoint(deviceId, point);
    this.bump(deviceId);
  }

  async clearDeviceHistory(deviceId: string) {
    await this.inner.clearDeviceHistory(deviceId);
    this.bump(deviceId);
    this.cache.clear();
  }

  async runRetentionCleanup() {
    if (!this.inner.runRetentionCleanup) return;
    await this.inner.runRetentionCleanup.call(this.inner);
    this.cache.clear();
  }

  async flushWrites(): Promise<void> {
    await this.inner.flushWrites?.();
  }

  getHistoricalSeries(deviceId: string, bucket: MetricWindow): Promise<TimeSeriesRecord[]> {
    if (!this.options.ttlMs) return this.inner.getHistoricalSeries(deviceId, bucket);
    return this.readThrough(
      `history:${deviceId}:${bucket}:${this.epoch(deviceId)}`,
      this.options.ttlMs,
      () => this.inner.getHistoricalSeries(deviceId, bucket)
    );
  }

  async getOverviewSeries(deviceId: string, bucket: MetricWindow): Promise<OverviewRecord[]> {
    if (!this.options.ttlMs) {
      if (this.inner.getOverviewSeries) return this.inner.getOverviewSeries(deviceId, bucket);
      return (await this.inner.getHistoricalSeries(deviceId, bucket)).map(projectOverviewRecord);
    }
    return this.readThrough(
      `overview:${deviceId}:${bucket}:${this.epoch(deviceId)}`,
      this.options.ttlMs,
      async () => this.inner.getOverviewSeries
        ? this.inner.getOverviewSeries(deviceId, bucket)
        : (await this.inner.getHistoricalSeries(deviceId, bucket)).map(projectOverviewRecord)
    );
  }

  getTrafficSeries(deviceId: string, start: number, end: number): Promise<TrafficHistoryPoint[]> {
    if (!this.options.ttlMs) return this.inner.getTrafficSeries(deviceId, start, end);
    return this.readThrough(
      `traffic:${deviceId}:${start}:${end}:${this.epoch(deviceId)}`,
      this.options.ttlMs,
      () => this.inner.getTrafficSeries(deviceId, start, end)
    );
  }

  getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    if (!this.options.calendarTtlMs) return this.inner.getTrafficCalendar(deviceId, mode, anchorDate, selectedStart);
    const anchorKey = localDayKey(anchorDate);
    const selectedKey = selectedStart ? localDayKey(selectedStart) : "-";
    return this.readThrough(
      `calendar:${deviceId}:${mode}:${anchorKey}:${selectedKey}:${this.epoch(deviceId)}`,
      this.options.calendarTtlMs,
      () => this.inner.getTrafficCalendar(deviceId, mode, anchorDate, selectedStart)
    );
  }

  listKnownDevices() {
    return this.inner.listKnownDevices();
  }

  private epoch(deviceId: string): number {
    return this.epochs.get(deviceId) ?? 0;
  }

  private bump(deviceId: string) {
    this.epochs.set(deviceId, this.epoch(deviceId) + 1);
    if (this.epochs.size > 10_000) this.epochs.delete(this.epochs.keys().next().value!);
  }

  private async readThrough<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached as T;
    const joined = this.inflight.get(key);
    if (joined) return joined as Promise<T>;
    const operation = (async () => {
      const shared = await this.readShared(key);
      if (shared !== undefined) {
        this.cache.set(key, shared, ttlMs);
        return shared;
      }
      const value = await load();
      this.cache.set(key, value, ttlMs);
      await this.writeShared(key, value, ttlMs);
      return value;
    })().finally(() => {
      if (this.inflight.get(key) === operation) this.inflight.delete(key);
    });
    this.inflight.set(key, operation);
    return operation as Promise<T>;
  }

  private async readShared(key: string): Promise<unknown | undefined> {
    if (!this.options.shared) return undefined;
    try {
      const raw = await this.options.shared.get(key);
      if (raw == null) return undefined;
      return JSON.parse(raw) as unknown;
    } catch (error) {
      this.reportSharedError(error);
      return undefined;
    }
  }

  private async writeShared(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (!this.options.shared) return;
    if (estimateBytes(value) > this.options.maxBytes) return;
    try {
      await this.options.shared.set(key, JSON.stringify(value), ttlMs);
    } catch (error) {
      this.reportSharedError(error);
    }
  }

  private reportSharedError(error: unknown) {
    const now = Date.now();
    if (now - this.lastSharedErrorAt < 30_000) return;
    this.lastSharedErrorAt = now;
    this.options.onError?.(error);
  }
}

/** Traffic calendars are bucketed by the project's local day (UTC+8). */
function localDayKey(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "invalid";
  return new Date(parsed + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
