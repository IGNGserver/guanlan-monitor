import mysql from "mysql2/promise";
import type { MetricWindow, TrafficCalendarMode, TrafficCalendarResponse } from "@dsc/shared";
import type { HistoryRepository, TimeSeriesRecord } from "../types.js";
import { buildTrafficCalendar } from "../traffic-calendar.js";

const WINDOW_RANGES: Record<Extract<MetricWindow, "1d" | "1w" | "1mo" | "1y">, number> = {
  "1d": 24,
  "1w": 24 * 7,
  "1mo": 24 * 31,
  "1y": 24 * 366
};
const MINUTE_RETENTION_DAYS = 90;
const HOURLY_RETENTION_DAYS = 370;

export class MysqlHistoryRepository implements HistoryRepository {
  constructor(private readonly pool: mysql.Pool) {}

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS device_minute_metrics (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(128) NOT NULL,
        recorded_at DATETIME NOT NULL,
        cpu_usage_percent DOUBLE NOT NULL,
        cpu_frequency_mhz DOUBLE NOT NULL DEFAULT 0,
        cpu_temperature_c DOUBLE NOT NULL DEFAULT 0,
        gpu_usage_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_encode_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_decode_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_frequency_mhz DOUBLE NOT NULL DEFAULT 0,
        gpu_memory_usage_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_temperature_c DOUBLE NOT NULL DEFAULT 0,
        memory_usage_percent DOUBLE NOT NULL,
        swap_usage_percent DOUBLE NOT NULL,
        disk_usage_percent DOUBLE NOT NULL,
        disk_read_bytes_per_sec DOUBLE NOT NULL,
        disk_write_bytes_per_sec DOUBLE NOT NULL,
        network_rx_bytes_per_sec DOUBLE NOT NULL,
        network_tx_bytes_per_sec DOUBLE NOT NULL,
        traffic_rx_bytes DOUBLE NOT NULL,
        traffic_tx_bytes DOUBLE NOT NULL,
        disk_instances_json JSON NULL,
        gpu_instances_json JSON NULL,
        UNIQUE KEY uniq_device_minute (device_id, recorded_at),
        INDEX idx_device_minute_recorded_at (device_id, recorded_at)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS device_hourly_metrics (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        device_id VARCHAR(128) NOT NULL,
        recorded_at DATETIME NOT NULL,
        cpu_usage_percent DOUBLE NOT NULL,
        cpu_frequency_mhz DOUBLE NOT NULL DEFAULT 0,
        cpu_temperature_c DOUBLE NOT NULL DEFAULT 0,
        gpu_usage_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_encode_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_decode_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_frequency_mhz DOUBLE NOT NULL DEFAULT 0,
        gpu_memory_usage_percent DOUBLE NOT NULL DEFAULT 0,
        gpu_temperature_c DOUBLE NOT NULL DEFAULT 0,
        memory_usage_percent DOUBLE NOT NULL,
        swap_usage_percent DOUBLE NOT NULL,
        disk_usage_percent DOUBLE NOT NULL,
        disk_read_bytes_per_sec DOUBLE NOT NULL,
        disk_write_bytes_per_sec DOUBLE NOT NULL,
        network_rx_bytes_per_sec DOUBLE NOT NULL,
        network_tx_bytes_per_sec DOUBLE NOT NULL,
        traffic_rx_bytes DOUBLE NOT NULL,
        traffic_tx_bytes DOUBLE NOT NULL,
        disk_instances_json JSON NULL,
        gpu_instances_json JSON NULL,
        UNIQUE KEY uniq_device_hour (device_id, recorded_at),
        INDEX idx_device_recorded_at (device_id, recorded_at)
      )
    `);
    await this.ensureColumn("device_minute_metrics", "cpu_frequency_mhz", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "cpu_temperature_c", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_usage_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_encode_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_decode_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_frequency_mhz", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_memory_usage_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "gpu_temperature_c", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "cpu_frequency_mhz", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "cpu_temperature_c", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_usage_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_encode_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_decode_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_frequency_mhz", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_memory_usage_percent", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_hourly_metrics", "gpu_temperature_c", "DOUBLE NOT NULL DEFAULT 0");
    await this.ensureColumn("device_minute_metrics", "disk_instances_json", "JSON NULL");
    await this.ensureColumn("device_minute_metrics", "gpu_instances_json", "JSON NULL");
    await this.ensureColumn("device_hourly_metrics", "disk_instances_json", "JSON NULL");
    await this.ensureColumn("device_hourly_metrics", "gpu_instances_json", "JSON NULL");
    await this.runRetentionCleanup();
  }

  async ensureColumn(tableName: string, columnName: string, definition: string) {
    const [rows] = await this.pool.query<any[]>(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
    if (rows.length > 0) return;
    await this.pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  async runRetentionCleanup() {
    await this.pool.query(
      `
        DELETE FROM device_minute_metrics
        WHERE recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      `,
      [MINUTE_RETENTION_DAYS]
    );
    await this.pool.query(
      `
        DELETE FROM device_hourly_metrics
        WHERE recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      `,
      [HOURLY_RETENTION_DAYS]
    );
  }

  async insertMinutePoint(deviceId: string, point: TimeSeriesRecord) {
    await this.pool.query(
      `
        INSERT INTO device_minute_metrics (
          device_id, recorded_at, cpu_usage_percent, cpu_frequency_mhz, cpu_temperature_c, gpu_usage_percent, gpu_encode_percent, gpu_decode_percent, gpu_frequency_mhz, gpu_memory_usage_percent, gpu_temperature_c, memory_usage_percent, swap_usage_percent,
          disk_usage_percent, disk_read_bytes_per_sec, disk_write_bytes_per_sec,
          network_rx_bytes_per_sec, network_tx_bytes_per_sec, traffic_rx_bytes, traffic_tx_bytes,
          disk_instances_json, gpu_instances_json
        ) VALUES (?, FROM_UNIXTIME(? / 1000), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          cpu_usage_percent = VALUES(cpu_usage_percent),
          cpu_frequency_mhz = VALUES(cpu_frequency_mhz),
          cpu_temperature_c = VALUES(cpu_temperature_c),
          gpu_usage_percent = VALUES(gpu_usage_percent),
          gpu_encode_percent = VALUES(gpu_encode_percent),
          gpu_decode_percent = VALUES(gpu_decode_percent),
          gpu_frequency_mhz = VALUES(gpu_frequency_mhz),
          gpu_memory_usage_percent = VALUES(gpu_memory_usage_percent),
          gpu_temperature_c = VALUES(gpu_temperature_c),
          memory_usage_percent = VALUES(memory_usage_percent),
          swap_usage_percent = VALUES(swap_usage_percent),
          disk_usage_percent = VALUES(disk_usage_percent),
          disk_read_bytes_per_sec = VALUES(disk_read_bytes_per_sec),
          disk_write_bytes_per_sec = VALUES(disk_write_bytes_per_sec),
          network_rx_bytes_per_sec = VALUES(network_rx_bytes_per_sec),
          network_tx_bytes_per_sec = VALUES(network_tx_bytes_per_sec),
          traffic_rx_bytes = VALUES(traffic_rx_bytes),
          traffic_tx_bytes = VALUES(traffic_tx_bytes),
          disk_instances_json = VALUES(disk_instances_json),
          gpu_instances_json = VALUES(gpu_instances_json)
      `,
      [
        deviceId,
        point.timestamp,
        point.cpuUsagePercent,
        point.cpuFrequencyMHz,
        point.cpuTemperatureC,
        point.gpuUsagePercent,
        point.gpuEncodePercent,
        point.gpuDecodePercent,
        point.gpuFrequencyMHz,
        point.gpuMemoryUsagePercent,
        point.gpuTemperatureC,
        point.memoryUsagePercent,
        point.swapUsagePercent,
        point.diskUsagePercent,
        point.diskReadBytesPerSec,
        point.diskWriteBytesPerSec,
        point.networkRxBytesPerSec,
        point.networkTxBytesPerSec,
        point.trafficRxBytes,
        point.trafficTxBytes,
        JSON.stringify(point.disks ?? []),
        JSON.stringify(point.gpus ?? [])
      ]
    );
  }

  async insertHourlyPoint(deviceId: string, point: TimeSeriesRecord) {
    await this.pool.query(
      `
        INSERT INTO device_hourly_metrics (
          device_id, recorded_at, cpu_usage_percent, cpu_frequency_mhz, cpu_temperature_c, gpu_usage_percent, gpu_encode_percent, gpu_decode_percent, gpu_frequency_mhz, gpu_memory_usage_percent, gpu_temperature_c, memory_usage_percent, swap_usage_percent,
          disk_usage_percent, disk_read_bytes_per_sec, disk_write_bytes_per_sec,
          network_rx_bytes_per_sec, network_tx_bytes_per_sec, traffic_rx_bytes, traffic_tx_bytes,
          disk_instances_json, gpu_instances_json
        ) VALUES (?, FROM_UNIXTIME(? / 1000), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          cpu_usage_percent = VALUES(cpu_usage_percent),
          cpu_frequency_mhz = VALUES(cpu_frequency_mhz),
          cpu_temperature_c = VALUES(cpu_temperature_c),
          gpu_usage_percent = VALUES(gpu_usage_percent),
          gpu_encode_percent = VALUES(gpu_encode_percent),
          gpu_decode_percent = VALUES(gpu_decode_percent),
          gpu_frequency_mhz = VALUES(gpu_frequency_mhz),
          gpu_memory_usage_percent = VALUES(gpu_memory_usage_percent),
          gpu_temperature_c = VALUES(gpu_temperature_c),
          memory_usage_percent = VALUES(memory_usage_percent),
          swap_usage_percent = VALUES(swap_usage_percent),
          disk_usage_percent = VALUES(disk_usage_percent),
          disk_read_bytes_per_sec = VALUES(disk_read_bytes_per_sec),
          disk_write_bytes_per_sec = VALUES(disk_write_bytes_per_sec),
          network_rx_bytes_per_sec = VALUES(network_rx_bytes_per_sec),
          network_tx_bytes_per_sec = VALUES(network_tx_bytes_per_sec),
          traffic_rx_bytes = VALUES(traffic_rx_bytes),
          traffic_tx_bytes = VALUES(traffic_tx_bytes),
          disk_instances_json = VALUES(disk_instances_json),
          gpu_instances_json = VALUES(gpu_instances_json)
      `,
      [
        deviceId,
        point.timestamp,
        point.cpuUsagePercent,
        point.cpuFrequencyMHz,
        point.cpuTemperatureC,
        point.gpuUsagePercent,
        point.gpuEncodePercent,
        point.gpuDecodePercent,
        point.gpuFrequencyMHz,
        point.gpuMemoryUsagePercent,
        point.gpuTemperatureC,
        point.memoryUsagePercent,
        point.swapUsagePercent,
        point.diskUsagePercent,
        point.diskReadBytesPerSec,
        point.diskWriteBytesPerSec,
        point.networkRxBytesPerSec,
        point.networkTxBytesPerSec,
        point.trafficRxBytes,
        point.trafficTxBytes,
        JSON.stringify(point.disks ?? []),
        JSON.stringify(point.gpus ?? [])
      ]
    );
  }

  async getHistoricalSeries(deviceId: string, bucket: MetricWindow) {
    if (bucket === "1m" || bucket === "15m") {
      return [];
    }
    if (bucket === "1d") {
      const [rows] = await this.pool.query<any[]>(
        `
          SELECT
            UNIX_TIMESTAMP(recorded_at) * 1000 AS timestamp,
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
            gpu_instances_json AS gpuInstancesJson
          FROM device_minute_metrics
          WHERE device_id = ?
            AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
          ORDER BY recorded_at ASC
        `,
        [deviceId]
      );

      return rows.map(mapHistoryRow) as TimeSeriesRecord[];
    }
    const hours = WINDOW_RANGES[bucket];
    const [rows] = await this.pool.query<any[]>(
      `
        SELECT
          UNIX_TIMESTAMP(recorded_at) * 1000 AS timestamp,
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
          gpu_instances_json AS gpuInstancesJson
        FROM device_hourly_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)
        ORDER BY recorded_at ASC
      `,
      [deviceId, hours]
    );

    return rows.map(mapHistoryRow) as TimeSeriesRecord[];
  }

  async clearDeviceHistory(deviceId: string) {
    await this.pool.query(`DELETE FROM device_minute_metrics WHERE device_id = ?`, [deviceId]);
    await this.pool.query(`DELETE FROM device_hourly_metrics WHERE device_id = ?`, [deviceId]);
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchorDate: string,
    selectedStart?: string
  ): Promise<TrafficCalendarResponse> {
    const [minuteRows] = await this.pool.query<any[]>(
      `
        SELECT
          UNIX_TIMESTAMP(recorded_at) * 1000 AS timestamp,
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
          gpu_instances_json AS gpuInstancesJson
        FROM device_minute_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        ORDER BY recorded_at ASC
      `,
      [deviceId, MINUTE_RETENTION_DAYS]
    );

    const [hourlyRows] = await this.pool.query<any[]>(
      `
        SELECT
          UNIX_TIMESTAMP(recorded_at) * 1000 AS timestamp,
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
          gpu_instances_json AS gpuInstancesJson
        FROM device_hourly_metrics
        WHERE device_id = ?
          AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
          AND recorded_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
        ORDER BY recorded_at ASC
      `,
      [deviceId, HOURLY_RETENTION_DAYS, MINUTE_RETENTION_DAYS]
    );

    return buildTrafficCalendar(
      [...hourlyRows.map(mapHistoryRow), ...minuteRows.map(mapHistoryRow)],
      mode,
      anchorDate,
      selectedStart
    );
  }
}

function mapHistoryRow(row: any): TimeSeriesRecord {
  return {
    ...row,
    disks: parseJsonArray(row.diskInstancesJson),
    gpus: parseJsonArray(row.gpuInstancesJson)
  };
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
