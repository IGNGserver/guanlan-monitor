import mysql, { type RowDataPacket } from "mysql2/promise";
import type { MetricWindow, TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type { HistoryRepository, OverviewRecord, TimeSeriesRecord, TrafficHistoryPoint } from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";
import { MysqlHistoryWriteBatcher, type HistoryWriteBatcherOptions } from "../storage/mysql-write-batcher.js";
import {
  HISTORY_COLUMNS,
  HISTORY_INDEXES,
  createHistoryTableSql,
  formatRecordedAt
} from "./history-schema.js";

const WINDOW_RANGES: Record<Extract<MetricWindow, "1d" | "7d" | "1w" | "30d" | "1mo" | "90d" | "1y">, number> = {
  "7d": 24 * 7,
  "1d": 24,
  "1w": 24 * 7,
  "30d": 24 * 31,
  "1mo": 24 * 31,
  "90d": 24 * 90,
  "1y": 24 * 366
};
const MINUTE_RETENTION_DAYS = 90;
const HOURLY_RETENTION_DAYS = 370;

export interface MysqlHistoryOptions {
  queryTimeoutMs?: number;
  batch?: HistoryWriteBatcherOptions;
}

export class MysqlHistoryRepository implements HistoryRepository {
  private readonly writer: MysqlHistoryWriteBatcher;
  private readonly queryTimeoutMs: number;

  constructor(private readonly pool: mysql.Pool, options: MysqlHistoryOptions = {}) {
    this.queryTimeoutMs = options.queryTimeoutMs ?? 15_000;
    this.writer = new MysqlHistoryWriteBatcher(pool, {
      queryTimeoutMs: this.queryTimeoutMs,
      ...options.batch
    });
  }

  private async queryRows<T extends RowDataPacket = RowDataPacket>(sql: string, values: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query<T[]>(
      values.length
        ? { sql, values, timeout: this.queryTimeoutMs }
        : { sql, timeout: this.queryTimeoutMs }
    );
    return rows;
  }

  async checkReadiness(): Promise<void> {
    // Exercise the same pool as history, without scanning any telemetry rows.
    await this.pool.query({ sql: "SELECT 1", timeout: 2000 });
  }

  /** Create missing tables/columns/indexes in a bounded number of round trips. */
  async init() {
    await this.pool.query(createHistoryTableSql("device_minute_metrics", "uniq_device_minute"));
    await this.pool.query(createHistoryTableSql("device_hourly_metrics", "uniq_device_hour"));
    await this.ensureSchema();
  }

  /** Flush buffered multi-row writes before the pool is closed. */
  async flushWrites(): Promise<void> {
    await this.writer.flush();
  }

  private async ensureSchema() {
    const [columnRows] = await this.pool.query<RowDataPacket[]>(`
      SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('device_minute_metrics', 'device_hourly_metrics')
    `);
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const table = String(row.tableName);
      const columns = columnsByTable.get(table) ?? new Set<string>();
      columns.add(String(row.columnName));
      columnsByTable.set(table, columns);
    }
    for (const table of ["device_minute_metrics", "device_hourly_metrics"] as const) {
      const existing = columnsByTable.get(table) ?? new Set<string>();
      const missing = HISTORY_COLUMNS.filter((column) => !existing.has(column.name));
      if (!missing.length) continue;
      const clauses = missing.map((column) => `ADD COLUMN ${column.name} ${column.definition}`).join(", ");
      await this.pool.query(`ALTER TABLE ${table} ${clauses}`);
    }

    const [indexRows] = await this.pool.query<RowDataPacket[]>(`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('device_minute_metrics', 'device_hourly_metrics')
    `);
    const indexesByTable = new Map<string, Set<string>>();
    for (const row of indexRows) {
      const table = String(row.tableName);
      const indexes = indexesByTable.get(table) ?? new Set<string>();
      indexes.add(String(row.indexName));
      indexesByTable.set(table, indexes);
    }
    for (const table of ["device_minute_metrics", "device_hourly_metrics"] as const) {
      const existing = indexesByTable.get(table) ?? new Set<string>();
      const missing = HISTORY_INDEXES[table].filter((index) => !existing.has(index.name));
      if (!missing.length) continue;
      const clauses = missing.map((index) => `ADD INDEX ${index.name} ${index.definition}`).join(", ");
      await this.pool.query(`ALTER TABLE ${table} ${clauses}`).catch((error) => {
        console.warn(`Could not add history index on ${table}; queries may be slower:`, error instanceof Error ? error.message : error);
      });
    }
  }

  async runRetentionCleanup(batchSize = 5000) {
    // Bounded batch deletion using index on recorded_at to avoid long table locks
    while (true) {
      const [result] = await this.pool.query<any>({
        sql: `
          DELETE FROM device_minute_metrics
          WHERE recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${MINUTE_RETENTION_DAYS} DAY)
          LIMIT ?
        `,
        values: [batchSize],
        timeout: Math.max(this.queryTimeoutMs, 60_000)
      });
      if (!result || result.affectedRows === 0 || result.affectedRows < batchSize) break;
    }
    while (true) {
      const [result] = await this.pool.query<any>({
        sql: `
          DELETE FROM device_hourly_metrics
          WHERE recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${HOURLY_RETENTION_DAYS} DAY)
          LIMIT ?
        `,
        values: [batchSize],
        timeout: Math.max(this.queryTimeoutMs, 60_000)
      });
      if (!result || result.affectedRows === 0 || result.affectedRows < batchSize) break;
    }
  }

  async insertMinutePoint(deviceId: string, point: TimeSeriesRecord) {
    await this.writer.insertMinutePoint(deviceId, point);
  }

  async insertHourlyPoint(deviceId: string, point: TimeSeriesRecord) {
    await this.writer.insertHourlyPoint(deviceId, point);
  }

  async getHistoricalSeries(deviceId: string, bucket: MetricWindow) {
    if (bucket === "1m" || bucket === "5m") {
      return [];
    }
    if (bucket === "15m" || bucket === "1h" || bucket === "6h" || bucket === "24h" || bucket === "1d") {
      const minutes = bucket === "15m" ? 15 : bucket === "1h" ? 60 : bucket === "6h" ? 360 : 1440;
      const rows = await this.queryRows<any>(
        `
          SELECT
            TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
            cpu_usage_percent AS cpuUsagePercent,
            cpu_frequency_mhz AS cpuFrequencyMHz,
            cpu_temperature_c AS cpuTemperatureC,
            gpu_usage_percent AS gpuUsagePercent,
            gpu_encode_percent AS gpuEncodePercent,
            gpu_decode_percent AS gpuDecodePercent,
            gpu_frequency_mhz AS gpuFrequencyMHz,
            gpu_memory_usage_percent AS gpuMemoryUsagePercent,
            gpu_temperature_c AS gpuTemperatureC,
            memory_usage_percent AS memoryUsagePercent,
            swap_usage_percent AS swapUsagePercent,
            disk_usage_percent AS diskUsagePercent,
            disk_read_bytes_per_sec AS diskReadBytesPerSec,
            disk_write_bytes_per_sec AS diskWriteBytesPerSec,
            network_rx_bytes_per_sec AS networkRxBytesPerSec,
            network_tx_bytes_per_sec AS networkTxBytesPerSec,
            traffic_rx_bytes AS trafficRxBytes,
            traffic_tx_bytes AS trafficTxBytes,
            disk_instances_json AS diskInstancesJson,
            gpu_instances_json AS gpuInstancesJson,
            recorded_details_json AS recordedDetailsJson
          FROM device_minute_metrics
          WHERE device_id = ?
            AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
          ORDER BY recorded_at ASC
        `,
        [deviceId, minutes]
      );

      return rows.map(mapHistoryRow) as TimeSeriesRecord[];
    }
    const hours = WINDOW_RANGES[bucket as keyof typeof WINDOW_RANGES] ?? WINDOW_RANGES["1y"];
    const rows = await this.queryRows<any>(
      `
        SELECT
          TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
          cpu_usage_percent AS cpuUsagePercent,
          cpu_frequency_mhz AS cpuFrequencyMHz,
          cpu_temperature_c AS cpuTemperatureC,
          gpu_usage_percent AS gpuUsagePercent,
          gpu_encode_percent AS gpuEncodePercent,
          gpu_decode_percent AS gpuDecodePercent,
          gpu_frequency_mhz AS gpuFrequencyMHz,
          gpu_memory_usage_percent AS gpuMemoryUsagePercent,
          gpu_temperature_c AS gpuTemperatureC,
          memory_usage_percent AS memoryUsagePercent,
          swap_usage_percent AS swapUsagePercent,
          disk_usage_percent AS diskUsagePercent,
          disk_read_bytes_per_sec AS diskReadBytesPerSec,
          disk_write_bytes_per_sec AS diskWriteBytesPerSec,
          network_rx_bytes_per_sec AS networkRxBytesPerSec,
          network_tx_bytes_per_sec AS networkTxBytesPerSec,
          traffic_rx_bytes AS trafficRxBytes,
          traffic_tx_bytes AS trafficTxBytes,
          disk_instances_json AS diskInstancesJson,
          gpu_instances_json AS gpuInstancesJson,
          recorded_details_json AS recordedDetailsJson
        FROM device_hourly_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
        ORDER BY recorded_at ASC
      `,
      [deviceId, hours]
    );

    return rows.map(mapHistoryRow) as TimeSeriesRecord[];
  }

  async getOverviewSeries(deviceId: string, bucket: MetricWindow): Promise<OverviewRecord[]> {
    if (bucket === "1m" || bucket === "5m") return [];
    const minute = bucket === "15m" || bucket === "1h" || bucket === "6h" || bucket === "24h" || bucket === "1d";
    const range = minute ? (bucket === "15m" ? 15 : bucket === "1h" ? 60 : bucket === "6h" ? 360 : 1440)
      : WINDOW_RANGES[bucket as keyof typeof WINDOW_RANGES] ?? WINDOW_RANGES["1y"];
    // Table/unit are internal constants, never user-provided identifiers. Extract
    // only needed JSON paths: no hardware detail or instance objects leave MySQL.
    // Nonempty instances win even if every usedBytes is zero/missing; testing
    // their sum for truthiness would incorrectly select older detail disks.
    const rows = await this.queryRows<any>(`
      SELECT TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
             cpu_usage_percent AS cpuUsagePercent,
             network_rx_bytes_per_sec AS networkRxBytesPerSec,
             network_tx_bytes_per_sec AS networkTxBytesPerSec,
             JSON_EXTRACT(recorded_details_json, '$.memory.usedBytes') AS memoryUsedJson,
             CASE WHEN JSON_TYPE(disk_instances_json) = 'ARRAY' AND JSON_LENGTH(disk_instances_json) > 0
               THEN JSON_EXTRACT(disk_instances_json, '$[*].usedBytes')
               ELSE JSON_EXTRACT(recorded_details_json, '$.disks[*].usedBytes')
             END AS diskUsedValuesJson,
             JSON_EXTRACT(recorded_details_json, '$.metricQuality') AS metricQualityJson,
             JSON_EXTRACT(recorded_details_json, '$.unavailableMetrics') AS unavailableMetricsJson
      FROM ${minute ? "device_minute_metrics" : "device_hourly_metrics"}
      WHERE device_id = ?
        AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? ${minute ? "MINUTE" : "HOUR"})
      ORDER BY recorded_at ASC
    `, [deviceId, range]);
    return rows.map((row) => ({
      timestamp: Number(row.timestamp),
      cpuUsagePercent: Number(row.cpuUsagePercent),
      memoryUsedBytes: parseJsonNumber(row.memoryUsedJson),
      diskUsedBytes: parseJsonArray(row.diskUsedValuesJson).reduce((total, value) => total + Number(value ?? 0), 0),
      networkRxBytesPerSec: Number(row.networkRxBytesPerSec),
      networkTxBytesPerSec: Number(row.networkTxBytesPerSec),
      metricQuality: parseJsonObject(row.metricQualityJson),
      unavailableMetrics: parseJsonArray(row.unavailableMetricsJson)
    }));
  }

  async clearDeviceHistory(deviceId: string) {
    await this.pool.query({
      sql: "DELETE FROM device_minute_metrics WHERE device_id = ?",
      values: [deviceId],
      timeout: this.queryTimeoutMs
    });
    await this.pool.query({
      sql: "DELETE FROM device_hourly_metrics WHERE device_id = ?",
      values: [deviceId],
      timeout: this.queryTimeoutMs
    });
  }

  async listKnownDevices() {
    const rows = await this.queryRows<(RowDataPacket & { deviceId: string; lastSeenAt: string })>(`
      SELECT device_id AS deviceId, DATE_FORMAT(MAX(recorded_at), '%Y-%m-%dT%H:%i:%s.000Z') AS lastSeenAt
      FROM (
        SELECT device_id, MAX(recorded_at) AS recorded_at FROM device_minute_metrics GROUP BY device_id
        UNION ALL
        SELECT device_id, MAX(recorded_at) AS recorded_at FROM device_hourly_metrics GROUP BY device_id
      ) AS history
      GROUP BY device_id
    `);
    return rows;
  }

  async getTrafficSeries(deviceId: string, start: number, end: number): Promise<TrafficHistoryPoint[]> {
    // Compare UTC DATETIME literals rather than session-local FROM_UNIXTIME;
    // this keeps an external server's default time zone out of the range.
    const [rows] = await this.pool.query<(RowDataPacket & TrafficHistoryPoint)[]>({
      sql: `
        SELECT TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
               traffic_rx_bytes AS trafficRxBytes, traffic_tx_bytes AS trafficTxBytes
        FROM device_hourly_metrics
        WHERE device_id = ? AND recorded_at >= ?
          AND recorded_at < ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 366 DAY)
        ORDER BY recorded_at ASC
      `,
      values: [deviceId, formatRecordedAt(Math.ceil(start / 1000) * 1000), formatRecordedAt(Math.ceil(end / 1000) * 1000)],
      timeout: this.queryTimeoutMs
    });
    return rows.map((row) => ({ timestamp: Number(row.timestamp), trafficRxBytes: Number(row.trafficRxBytes), trafficTxBytes: Number(row.trafficTxBytes) }));
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    // buildTrafficCalendar only consumes counter timestamps. Never select
    // hardware detail JSON here: 90 days of minute rows would otherwise move
    // gigabytes per request on a remote database.
    const [minuteRows] = await this.pool.query<RowDataPacket[]>({
      sql: `
        SELECT TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
               traffic_rx_bytes AS trafficRxBytes,
               traffic_tx_bytes AS trafficTxBytes
        FROM device_minute_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        ORDER BY recorded_at ASC
      `,
      values: [deviceId, MINUTE_RETENTION_DAYS],
      timeout: this.queryTimeoutMs
    });

    const [hourlyRows] = await this.pool.query<RowDataPacket[]>({
      sql: `
        SELECT TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', recorded_at) * 1000 AS timestamp,
               traffic_rx_bytes AS trafficRxBytes,
               traffic_tx_bytes AS trafficTxBytes
        FROM device_hourly_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          AND recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        ORDER BY recorded_at ASC
      `,
      values: [deviceId, HOURLY_RETENTION_DAYS, MINUTE_RETENTION_DAYS],
      timeout: this.queryTimeoutMs
    });

    const points: TrafficHistoryPoint[] = [...hourlyRows, ...minuteRows]
      .map((row) => ({
        timestamp: Number(row.timestamp),
        trafficRxBytes: Number(row.trafficRxBytes),
        trafficTxBytes: Number(row.trafficTxBytes)
      }))
      .sort((left, right) => left.timestamp - right.timestamp);

    return buildTrafficCalendar(points, mode, anchorDate, selectedStart);
  }
}

export function mapHistoryRow(row: any): TimeSeriesRecord {
  const recordedDetails = parseJsonObject(row.recordedDetailsJson) as TimeSeriesRecord["recordedDetails"];
  return {
    ...row,
    hardwareSampledAt: recordedDetails?.hardwareSampledAt,
    cpuTemperatureSampledAt: recordedDetails?.cpuTemperatureSampledAt,
    cpus: recordedDetails?.aggregatedInstances?.cpus,
    networks: recordedDetails?.aggregatedInstances?.networks,
    fans: recordedDetails?.aggregatedInstances?.fans,
    disks: parseJsonArray(row.diskInstancesJson),
    gpus: parseJsonArray(row.gpuInstancesJson),
    recordedDetails
  };
}

function parseJsonNumber(value: unknown): number {
  if (typeof value === "string") {
    try { return Number(JSON.parse(value) ?? 0); } catch { return Number(value); }
  }
  return Number(value ?? 0);
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: unknown) {
  if (value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
