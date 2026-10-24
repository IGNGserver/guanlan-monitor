import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { MysqlHistoryRepository } from "./history.js";
import { buildTrafficCalendar, trafficCalendarBounds } from "../traffic-calendar.js";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import { overviewToMetricSeries } from "../overview.js";
import { payloadToTimeSeries, timeSeriesToMetricSeries } from "../utils.js";

test("real MySQL: grouped discovery and ranged counter projection preserve results", { skip: !process.env.MYSQL_TEST_URL }, async () => {
  const url = new URL(process.env.MYSQL_TEST_URL!);
  assert.equal(url.hostname, "127.0.0.1", "only an isolated runner-local fixture database is permitted");
  assert.equal(url.pathname, "/guanlan_query_test");
  const connection = await mysql.createConnection(url.href);
  try {
    await connection.query("SET time_zone = '+00:00'");
    // Connection-scoped temporary tables: even a misconfigured test cannot
    // drop, truncate or insert into persistent application tables.
    for (const table of ["device_minute_metrics", "device_hourly_metrics"]) {
      await connection.query(`CREATE TEMPORARY TABLE ${table} (
        device_id VARCHAR(128) NOT NULL, recorded_at DATETIME NOT NULL,
        traffic_rx_bytes DOUBLE NOT NULL, traffic_tx_bytes DOUBLE NOT NULL,
        recorded_details_json JSON NULL,
        UNIQUE KEY device_time (device_id, recorded_at),
        INDEX idx_traffic_cover (device_id, recorded_at, traffic_rx_bytes, traffic_tx_bytes)
      )`);
    }
    const hour = Math.floor(Date.now() / 3600_000) * 3600_000;
    const rows: unknown[][] = [];
    for (const device of ["alpha", "beta"]) {
      for (let i = 0; i < 96; i++) rows.push([device, new Date(hour - (96 - i) * 3600_000), (i % 37) * 1000, (i % 43) * 2000, JSON.stringify({ fixture: "x".repeat(4096) })]);
    }
    rows.push(["expired", new Date(hour - 400 * 24 * 3600_000), 100, 200, "{}"]);
    await connection.query("INSERT INTO device_hourly_metrics VALUES ?", [rows]);
    await connection.query("INSERT INTO device_minute_metrics VALUES ?", [[
      ["alpha", new Date(hour), 5000, 7000, "{}"], ["minute-only", new Date(hour), 100, 200, "{}"]
    ]]);
    const history = new MysqlHistoryRepository(connection as unknown as mysql.Pool);
    const [legacyKnown] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT device_id AS deviceId, DATE_FORMAT(MAX(recorded_at), '%Y-%m-%dT%H:%i:%s.000Z') AS lastSeenAt
      FROM (SELECT device_id, recorded_at FROM device_minute_metrics UNION ALL
            SELECT device_id, recorded_at FROM device_hourly_metrics) AS history GROUP BY device_id
    `);
    const normalize = (list: Array<{ deviceId: string; lastSeenAt: string }>) => list.map(({ deviceId, lastSeenAt }) => ({ deviceId, lastSeenAt })).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
    assert.deepEqual(normalize(await history.listKnownDevices()), normalize(legacyKnown as Array<{ deviceId: string; lastSeenAt: string }>));
    const [legacyRows] = await connection.query<mysql.RowDataPacket[]>(`
      SELECT UNIX_TIMESTAMP(recorded_at)*1000 AS timestamp, traffic_rx_bytes AS trafficRxBytes,
             traffic_tx_bytes AS trafficTxBytes, recorded_details_json AS recordedDetailsJson
      FROM device_hourly_metrics WHERE device_id = 'alpha'
        AND recorded_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 366 DAY) ORDER BY recorded_at
    `);
    const full = legacyRows.map((row) => ({ ...row, timestamp: Number(row.timestamp), trafficRxBytes: Number(row.trafficRxBytes), trafficTxBytes: Number(row.trafficTxBytes) }));
    const anchor = new Date(hour).toISOString();
    for (const mode of ["day", "week", "month"] as const) {
      const { start, end } = trafficCalendarBounds(mode, anchor);
      const projected = await history.getTrafficSeries("alpha", start, end);
      assert.deepEqual(projected, full.filter((point) => point.timestamp >= start && point.timestamp < end).map(({ timestamp, trafficRxBytes, trafficTxBytes }) => ({ timestamp, trafficRxBytes, trafficTxBytes })));
      const expected = buildTrafficCalendar(full, mode, anchor);
      assert.deepEqual(buildTrafficCalendar(projected, mode, anchor), expected);
      for (const cell of [expected.cells[0], expected.cells.at(-1)!]) {
        assert.deepEqual(buildTrafficCalendar(projected, mode, anchor, cell.rangeStart), buildTrafficCalendar(full, mode, anchor, cell.rangeStart));
      }
      assert.ok(Buffer.byteLength(JSON.stringify(projected)) < Buffer.byteLength(JSON.stringify(full)) / 10, "counter projection must exclude the large fixture hardware detail");
    }
    assert.deepEqual(await history.getTrafficSeries("expired", hour - 401 * 24 * 3600_000, hour), [], "preserve the existing one-year read horizon");
    assert.deepEqual(await history.getTrafficSeries("missing", hour - 3600_000, hour), []);
  } finally { await connection.end(); }
});

test("real MySQL: overview JSON-path projection equals legacy five curves for old JSON, zero, missing quality and disk precedence", { skip: !process.env.MYSQL_TEST_URL }, async () => {
  const url = new URL(process.env.MYSQL_TEST_URL!);
  assert.equal(url.hostname, "127.0.0.1", "only an isolated runner-local fixture database is permitted");
  assert.equal(url.pathname, "/guanlan_query_test");
  const connection = await mysql.createConnection(url.href);
  try {
    await connection.query("SET time_zone = '+00:00'");
    const scalarColumns = ["cpu_usage_percent", "cpu_frequency_mhz", "cpu_temperature_c", "gpu_usage_percent", "gpu_encode_percent", "gpu_decode_percent",
      "gpu_frequency_mhz", "gpu_memory_usage_percent", "gpu_temperature_c", "memory_usage_percent", "swap_usage_percent", "disk_usage_percent",
      "disk_read_bytes_per_sec", "disk_write_bytes_per_sec", "network_rx_bytes_per_sec", "network_tx_bytes_per_sec", "traffic_rx_bytes", "traffic_tx_bytes"];
    for (const table of ["device_minute_metrics", "device_hourly_metrics"]) {
      await connection.query(`CREATE TEMPORARY TABLE ${table} (
        device_id VARCHAR(128) NOT NULL, recorded_at DATETIME NOT NULL,
        ${scalarColumns.map((column) => `${column} DOUBLE NOT NULL DEFAULT 0`).join(",")},
        disk_instances_json JSON NULL, gpu_instances_json JSON NULL, recorded_details_json JSON NULL,
        UNIQUE KEY device_time (device_id, recorded_at)
      )`);
    }
    const minute = Math.floor(Date.now() / 60_000) * 60_000;
    const rows: unknown[][] = [];
    for (let i = 0; i < 12; i++) {
      const point = payloadToTimeSeries(createHubContractPayload({ timestamp: minute - (12 - i) * 60_000 }));
      const details = point.recordedDetails!;
      let instances: unknown = [];
      let detailsJson: string | null = null;
      if (i === 1) instances = null;
      if (i === 2) instances = [{ usedBytes: 0 }, {}];
      if (i === 3) instances = [{}];
      if (i === 4) instances = [{ usedBytes: 7 }, { usedBytes: 11 }];
      if (i === 7) {
        details.memory.usedBytes = 0;
        details.metricQuality = { cpuUsage: { state: "direct" }, memoryUsage: { state: "derived" }, diskUsage: { state: "direct" }, networkRxRate: { state: "direct" }, networkTxRate: { state: "direct" } };
        instances = [{ usedBytes: 0 }];
      }
      if (i === 8) details.metricQuality = { cpuUsage: { state: "stale" }, memoryUsage: { state: "unavailable" }, diskUsage: { state: "not_applicable" }, networkRxRate: { state: "stale" } };
      if (i === 9) details.unavailableMetrics = ["diskUsage", "networkTxRate"];
      if (i === 10) detailsJson = JSON.stringify({ ...details, memory: {}, disks: [] });
      if (i === 11) instances = {};
      if (i !== 5 && i !== 6 && i !== 10) detailsJson = JSON.stringify({ ...details, fixtureHardware: "x".repeat(8192) });
      rows.push(["overview", new Date(point.timestamp), i === 7 ? 0 : point.cpuUsagePercent,
        i === 7 ? 0 : point.networkRxBytesPerSec, i === 7 ? 0 : point.networkTxBytesPerSec,
        JSON.stringify(instances), i === 6 ? "null" : detailsJson]);
    }
    rows.push(["expired", new Date(minute - 400 * 24 * 3600_000), 50, 60, 70, "[]", "null"]);
    for (const table of ["device_minute_metrics", "device_hourly_metrics"]) {
      await connection.query(`INSERT INTO ${table} (device_id, recorded_at, cpu_usage_percent, network_rx_bytes_per_sec, network_tx_bytes_per_sec, disk_instances_json, recorded_details_json) VALUES ?`, [rows]);
    }
    const repository = new MysqlHistoryRepository(connection as unknown as mysql.Pool);
    const fields = ["cpuUsagePercent", "memoryUsedBytes", "diskUsedBytes", "networkRxBytesPerSec", "networkTxBytesPerSec"] as const;
    for (const window of ["15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"] as const) {
      const full = await repository.getHistoricalSeries("overview", window);
      const narrow = await repository.getOverviewSeries("overview", window);
      const legacy = timeSeriesToMetricSeries(full);
      const actual = overviewToMetricSeries(narrow);
      assert.deepEqual(actual, Object.fromEntries(fields.map((field) => [field, legacy[field]])), window);
      assert.equal(narrow.length, 12);
      assert.equal(narrow[2].diskUsedBytes, 0, "all-zero nonempty instances must win over older detail disks");
      assert.equal(narrow[3].diskUsedBytes, 0, "missing values in nonempty instances must not select detail disks");
      assert.equal(narrow[4].diskUsedBytes, 18);
      assert.equal(narrow[5].memoryUsedBytes, 0);
      assert.equal(narrow[6].memoryUsedBytes, 0);
      assert.equal(narrow[7].memoryUsedBytes, 0);
      assert.ok(narrow[0].memoryUsedBytes > 0);
      assert.ok(narrow[0].diskUsedBytes > 0);
      assert.ok(narrow[11].diskUsedBytes > 0, "nonarray legacy instance JSON uses details just like mapHistoryRow");
      assert.ok(Buffer.byteLength(JSON.stringify(narrow)) < Buffer.byteLength(JSON.stringify(full)) / 10);
      assert.deepEqual(await repository.getOverviewSeries("expired", window), []);
      assert.deepEqual(await repository.getOverviewSeries("missing", window), []);
    }
  } finally { await connection.end(); }
});
