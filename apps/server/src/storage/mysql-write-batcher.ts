import type mysql from "mysql2/promise";
import type { TimeSeriesRecord } from "../types.js";
import { historyInsertSql, historyRowValues } from "../repositories/history-schema.js";

type Kind = "minute" | "hourly";

interface PendingRow {
  deviceId: string;
  point: TimeSeriesRecord;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface HistoryWriteBatcherOptions {
  maxRows?: number;
  maxBytes?: number;
  delayMs?: number;
  queryTimeoutMs?: number;
}

/**
 * Coalesce per-device history flush calls into a bounded multi-row UPSERT.
 *
 * The caller still awaits the resulting SQL before clearing its dirty flag.
 * A failed chunk rejects every caller in that chunk, so their accumulators
 * remain dirty and retry; rows are never silently acknowledged.
 */
export class MysqlHistoryWriteBatcher {
  private readonly buffers: Record<Kind, PendingRow[]> = { minute: [], hourly: [] };
  private readonly sql: Record<Kind, string> = {
    minute: historyInsertSql("device_minute_metrics"),
    hourly: historyInsertSql("device_hourly_metrics")
  };
  private readonly maxRows: number;
  private readonly maxBytes: number;
  private readonly delayMs: number;
  private readonly queryTimeoutMs: number;
  private readonly drains: Record<Kind, Promise<void> | null> = { minute: null, hourly: null };
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly pool: mysql.Pool, options: HistoryWriteBatcherOptions = {}) {
    this.maxRows = options.maxRows ?? 64;
    this.maxBytes = options.maxBytes ?? 512 * 1024;
    this.delayMs = options.delayMs ?? 5;
    this.queryTimeoutMs = options.queryTimeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.maxRows) || this.maxRows < 1) throw new RangeError("maxRows must be a positive integer");
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new RangeError("maxBytes must be a positive integer");
  }

  insertMinutePoint(deviceId: string, point: TimeSeriesRecord): Promise<void> {
    return this.enqueue("minute", deviceId, point);
  }

  insertHourlyPoint(deviceId: string, point: TimeSeriesRecord): Promise<void> {
    return this.enqueue("hourly", deviceId, point);
  }

  /** Flush both buffers; called during shutdown before the MySQL pool closes. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await Promise.all([this.drain("minute"), this.drain("hourly")]);
    // A buffer can receive rows while a drain is finishing; drain once more
    // until both buffers are empty.
    if (this.buffers.minute.length || this.buffers.hourly.length) {
      await this.flush();
    }
  }

  private enqueue(kind: Kind, deviceId: string, point: TimeSeriesRecord): Promise<void> {
    if (!Number.isFinite(point.timestamp)) return Promise.reject(new RangeError("point.timestamp must be finite"));
    return new Promise<void>((resolve, reject) => {
      this.buffers[kind].push({ deviceId, point, resolve, reject });
      if (this.bufferBytes(kind) >= this.maxBytes || this.buffers[kind].length >= this.maxRows) {
        void this.drain(kind).catch(() => undefined);
      } else {
        this.schedule();
      }
    });
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void Promise.all([this.drain("minute"), this.drain("hourly")]).catch(() => undefined);
    }, this.delayMs);
    this.timer.unref?.();
  }

  private drain(kind: Kind): Promise<void> {
    const existing = this.drains[kind];
    if (existing) return existing;
    const run = async () => {
      while (this.buffers[kind].length) {
        const batch: PendingRow[] = [];
        let bytes = 0;
        while (this.buffers[kind].length && batch.length < this.maxRows && bytes < this.maxBytes) {
          const next = this.buffers[kind].shift()!;
          batch.push(next);
          bytes += estimateRowBytes(next);
        }
        if (!batch.length) break;
        try {
          await this.pool.query({
            sql: this.sql[kind],
            values: [batch.map((row) => historyRowValues(row.deviceId, row.point))],
            timeout: this.queryTimeoutMs
          });
          for (const row of batch) row.resolve();
        } catch (error) {
          for (const row of batch) row.reject(error);
        }
      }
    };
    const promise = run().finally(() => {
      this.drains[kind] = null;
    });
    this.drains[kind] = promise;
    return promise;
  }

  private bufferBytes(kind: Kind): number {
    let bytes = 0;
    for (const row of this.buffers[kind]) bytes += estimateRowBytes(row);
    return bytes;
  }
}

function estimateRowBytes(row: PendingRow): number {
  try {
    return JSON.stringify(row.point).length * 2 + 256;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
