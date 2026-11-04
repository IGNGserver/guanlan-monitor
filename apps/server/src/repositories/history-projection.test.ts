import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { MysqlHistoryRepository } from "./history.js";
import { HISTORY_COLUMNS, HISTORY_INDEXES, createHistoryTableSql, historyRowValues } from "./history-schema.js";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import { payloadToTimeSeries } from "../utils.js";

test("traffic calendar queries only counter columns and passes the query timeout", async () => {
  const calls: Array<{ sql: string; values?: unknown[]; timeout?: number }> = [];
  const timestamp = Date.now();
  const pool = {
    query: async (query: { sql: string; values?: unknown[]; timeout?: number }) => {
      calls.push(query);
      return [[{ timestamp: String(timestamp), trafficRxBytes: "20", trafficTxBytes: "30" }], []];
    }
  } as unknown as mysql.Pool;
  const history = new MysqlHistoryRepository(pool, { queryTimeoutMs: 4321 });
  const result = await history.getTrafficCalendar("node", "day", new Date(timestamp).toISOString());
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /recorded_details_json|disk_instances_json|gpu_instances_json|cpu_usage_percent|SELECT\s+\*/i);
    assert.match(call.sql, /traffic_rx_bytes AS trafficRxBytes/);
    assert.equal(call.timeout, 4321);
    assert.equal(call.values?.[0], "node");
  }
  assert.ok(result.cells.length > 0);
});

test("history row tuples match the column contract and tables use binary ids", () => {
  const point = payloadToTimeSeries(createHubContractPayload({ deviceId: "row-contract" }));
  assert.equal(historyRowValues("row-contract", point).length, HISTORY_COLUMNS.length);
  const tableSql = createHistoryTableSql("device_minute_metrics", "uniq_device_minute");
  assert.match(tableSql, /DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin/);
  assert.match(tableSql, /id BIGINT PRIMARY KEY AUTO_INCREMENT/);
  assert.deepEqual(HISTORY_INDEXES.device_hourly_metrics.map((index) => index.name), [
    "idx_device_recorded_at",
    "idx_hourly_recorded_at",
    "idx_hourly_traffic_cover"
  ]);
});

test("history init batches schema discovery instead of 30 serial SHOW statements", async () => {
  const calls: string[] = [];
  const tables = ["device_minute_metrics", "device_hourly_metrics"] as const;
  const pool = {
    query: async (query: string | { sql: string }) => {
      const sql = typeof query === "string" ? query : query.sql;
      calls.push(sql);
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return [tables.flatMap((table) => HISTORY_COLUMNS.map((column) => ({ tableName: table, columnName: column.name }))), []];
      }
      if (sql.includes("INFORMATION_SCHEMA.STATISTICS")) {
        return [tables.flatMap((table) => HISTORY_INDEXES[table].map((index) => ({ tableName: table, indexName: index.name }))), []];
      }
      return [{}, []];
    }
  } as unknown as mysql.Pool;
  await new MysqlHistoryRepository(pool).init();
  assert.equal(calls.filter((sql) => /^\s*SHOW\s+(COLUMNS|INDEX)/i.test(sql)).length, 0);
  assert.ok(calls.some((sql) => sql.includes("INFORMATION_SCHEMA.COLUMNS")));
  assert.ok(calls.some((sql) => sql.includes("INFORMATION_SCHEMA.STATISTICS")));
  assert.ok(calls.filter((sql) => sql.startsWith("CREATE TABLE IF NOT EXISTS")).length === 2);
});
