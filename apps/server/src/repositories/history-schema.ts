import type { TimeSeriesRecord } from "../types.js";

export interface HistoryColumn {
  name: string;
  definition: string;
}

const BASE_COLUMNS: HistoryColumn[] = [
  { name: "device_id", definition: "VARCHAR(128) NOT NULL" },
  { name: "recorded_at", definition: "DATETIME NOT NULL" },
  { name: "cpu_usage_percent", definition: "DOUBLE NOT NULL" },
  { name: "cpu_frequency_mhz", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "cpu_temperature_c", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_usage_percent", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_encode_percent", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_decode_percent", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_frequency_mhz", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_memory_usage_percent", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "gpu_temperature_c", definition: "DOUBLE NOT NULL DEFAULT 0" },
  { name: "memory_usage_percent", definition: "DOUBLE NOT NULL" },
  { name: "swap_usage_percent", definition: "DOUBLE NOT NULL" },
  { name: "disk_usage_percent", definition: "DOUBLE NOT NULL" },
  { name: "disk_read_bytes_per_sec", definition: "DOUBLE NOT NULL" },
  { name: "disk_write_bytes_per_sec", definition: "DOUBLE NOT NULL" },
  { name: "network_rx_bytes_per_sec", definition: "DOUBLE NOT NULL" },
  { name: "network_tx_bytes_per_sec", definition: "DOUBLE NOT NULL" },
  { name: "traffic_rx_bytes", definition: "DOUBLE NOT NULL" },
  { name: "traffic_tx_bytes", definition: "DOUBLE NOT NULL" },
  { name: "disk_instances_json", definition: "JSON NULL" },
  { name: "gpu_instances_json", definition: "JSON NULL" },
  { name: "recorded_details_json", definition: "JSON NULL" },
  { name: "sample_count", definition: "INT NOT NULL DEFAULT 1" }
];

export const HISTORY_COLUMNS = BASE_COLUMNS;

const METRIC_UPDATE_ASSIGNMENTS = [
  "cpu_usage_percent = IF(sample_count >= VALUES(sample_count), cpu_usage_percent, VALUES(cpu_usage_percent))",
  "cpu_frequency_mhz = IF(sample_count >= VALUES(sample_count), cpu_frequency_mhz, VALUES(cpu_frequency_mhz))",
  "cpu_temperature_c = IF(sample_count >= VALUES(sample_count), cpu_temperature_c, VALUES(cpu_temperature_c))",
  "gpu_usage_percent = IF(sample_count >= VALUES(sample_count), gpu_usage_percent, VALUES(gpu_usage_percent))",
  "gpu_encode_percent = IF(sample_count >= VALUES(sample_count), gpu_encode_percent, VALUES(gpu_encode_percent))",
  "gpu_decode_percent = IF(sample_count >= VALUES(sample_count), gpu_decode_percent, VALUES(gpu_decode_percent))",
  "gpu_frequency_mhz = IF(sample_count >= VALUES(sample_count), gpu_frequency_mhz, VALUES(gpu_frequency_mhz))",
  "gpu_memory_usage_percent = IF(sample_count >= VALUES(sample_count), gpu_memory_usage_percent, VALUES(gpu_memory_usage_percent))",
  "gpu_temperature_c = IF(sample_count >= VALUES(sample_count), gpu_temperature_c, VALUES(gpu_temperature_c))",
  "memory_usage_percent = IF(sample_count >= VALUES(sample_count), memory_usage_percent, VALUES(memory_usage_percent))",
  "swap_usage_percent = IF(sample_count >= VALUES(sample_count), swap_usage_percent, VALUES(swap_usage_percent))",
  "disk_usage_percent = IF(sample_count >= VALUES(sample_count), disk_usage_percent, VALUES(disk_usage_percent))",
  "disk_read_bytes_per_sec = IF(sample_count >= VALUES(sample_count), disk_read_bytes_per_sec, VALUES(disk_read_bytes_per_sec))",
  "disk_write_bytes_per_sec = IF(sample_count >= VALUES(sample_count), disk_write_bytes_per_sec, VALUES(disk_write_bytes_per_sec))",
  "network_rx_bytes_per_sec = IF(sample_count >= VALUES(sample_count), network_rx_bytes_per_sec, VALUES(network_rx_bytes_per_sec))",
  "network_tx_bytes_per_sec = IF(sample_count >= VALUES(sample_count), network_tx_bytes_per_sec, VALUES(network_tx_bytes_per_sec))",
  "traffic_rx_bytes = IF(sample_count >= VALUES(sample_count), traffic_rx_bytes, VALUES(traffic_rx_bytes))",
  "traffic_tx_bytes = IF(sample_count >= VALUES(sample_count), traffic_tx_bytes, VALUES(traffic_tx_bytes))",
  "disk_instances_json = IF(sample_count >= VALUES(sample_count), disk_instances_json, VALUES(disk_instances_json))",
  "gpu_instances_json = IF(sample_count >= VALUES(sample_count), gpu_instances_json, VALUES(gpu_instances_json))",
  "recorded_details_json = IF(sample_count >= VALUES(sample_count), recorded_details_json, VALUES(recorded_details_json))",
  "sample_count = GREATEST(sample_count, VALUES(sample_count))"
];

/** Multi-row insert; VALUES(col) in the update clause resolves per inserted row. */
export function historyInsertSql(table: "device_minute_metrics" | "device_hourly_metrics"): string {
  return `INSERT INTO ${table} (${HISTORY_COLUMNS.map((column) => column.name).join(", ")})
    VALUES ?
    ON DUPLICATE KEY UPDATE ${METRIC_UPDATE_ASSIGNMENTS.join(",\n      ")}`;
}

export function createHistoryTableSql(table: "device_minute_metrics" | "device_hourly_metrics", uniqueKey: string): string {
  const columnSql = HISTORY_COLUMNS.map((column) => `        ${column.name} ${column.definition}`).join(",\n");
  return `CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
${columnSql},
        UNIQUE KEY ${uniqueKey} (device_id, recorded_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
}

/** DATETIME literal in UTC, independent of the MySQL session time zone. */
export function formatRecordedAt(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ");
}

export function historyRowValues(deviceId: string, point: TimeSeriesRecord): unknown[] {
  return [
    deviceId,
    formatRecordedAt(point.timestamp),
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
    JSON.stringify(point.gpus ?? []),
    JSON.stringify(point.recordedDetails ?? null),
    point.sampleCount ?? 1
  ];
}

export interface HistoryIndexDefinition {
  name: string;
  definition: string;
}

export const HISTORY_INDEXES: Record<"device_minute_metrics" | "device_hourly_metrics", HistoryIndexDefinition[]> = {
  device_minute_metrics: [
    { name: "idx_device_minute_recorded_at", definition: "(device_id, recorded_at)" },
    { name: "idx_minute_recorded_at", definition: "(recorded_at)" }
  ],
  device_hourly_metrics: [
    { name: "idx_device_recorded_at", definition: "(device_id, recorded_at)" },
    { name: "idx_hourly_recorded_at", definition: "(recorded_at)" },
    { name: "idx_hourly_traffic_cover", definition: "(device_id, recorded_at, traffic_rx_bytes, traffic_tx_bytes)" }
  ]
};
