import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import { payloadToTimeSeries } from "../utils.js";
import { MysqlHistoryWriteBatcher } from "./mysql-write-batcher.js";

function point(offset = 0) {
  const payload = createHubContractPayload({ deviceId: "batcher-node", timestamp: Date.parse("2026-10-01T00:00:00.000Z") + offset });
  return payloadToTimeSeries(payload);
}

test("minute batches coalesce rows into one bounded UPSERT", async () => {
  const queries: Array<{ sql: string; values?: unknown[]; timeout?: number }> = [];
  const pool = {
    query: async (query: { sql: string; values?: unknown[]; timeout?: number }) => {
      queries.push(query);
      return [{ affectedRows: 2 }, []];
    }
  } as unknown as mysql.Pool;
  const batcher = new MysqlHistoryWriteBatcher(pool, { maxRows: 2, delayMs: 500, queryTimeoutMs: 1234 });
  await Promise.all([
    batcher.insertMinutePoint("node-a", point(0)),
    batcher.insertMinutePoint("node-b", point(60_000))
  ]);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO device_minute_metrics/);
  assert.match(queries[0].sql, /VALUES \?/);
  assert.equal(queries[0].timeout, 1234);
  const rows = queries[0].values?.[0] as unknown[][];
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "node-a");
  assert.equal(rows[1][0], "node-b");
  assert.match(String(rows[0][1]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("hourly rows use the hourly table and flush waits for buffered rows", async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (query: { sql: string; values?: unknown[] }) => {
      queries.push(query);
      return [{ affectedRows: 1 }, []];
    }
  } as unknown as mysql.Pool;
  const batcher = new MysqlHistoryWriteBatcher(pool, { maxRows: 100, delayMs: 60_000 });
  const pending = batcher.insertHourlyPoint("node-a", point());
  await batcher.flush();
  await pending;
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO device_hourly_metrics/);
});

test("failed batches reject every caller so dirty buckets retry", async () => {
  const pool = {
    query: async () => { throw new Error("synthetic write failure"); }
  } as unknown as mysql.Pool;
  const batcher = new MysqlHistoryWriteBatcher(pool, { maxRows: 2, delayMs: 500 });
  const first = batcher.insertMinutePoint("node-a", point());
  const second = batcher.insertMinutePoint("node-b", point(60_000));
  await assert.rejects(Promise.all([first, second]), /synthetic write failure/);
});
