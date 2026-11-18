import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { ensureCaseSensitiveDeviceId } from "./device-id-collation.js";

class FakePool {
  collation = "utf8mb4_unicode_ci";
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];

  async query(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ collationName: this.collation }], []];
    if (sql.startsWith("ALTER TABLE")) {
      this.collation = "utf8mb4_bin";
      return [{ affectedRows: 0 }, []];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

test("legacy case-insensitive device ids are migrated once", async () => {
  const pool = new FakePool();
  assert.equal(await ensureCaseSensitiveDeviceId(pool as unknown as mysql.Pool, "devices"), true);
  assert.match(
    pool.queries.at(-1)!.sql,
    /^ALTER TABLE devices MODIFY device_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL$/
  );
  assert.deepEqual(pool.queries.at(-1)!.params, undefined, "the table name is a constant, not a bound value");
  assert.equal(await ensureCaseSensitiveDeviceId(pool as unknown as mysql.Pool, "devices"), false);
  assert.equal(pool.queries.filter(({ sql }) => sql.startsWith("ALTER TABLE")).length, 1);
});

test("binary columns and unknown tables never issue an ALTER", async () => {
  const pool = new FakePool();
  pool.collation = "utf8mb4_bin";
  assert.equal(await ensureCaseSensitiveDeviceId(pool as unknown as mysql.Pool, "device_minute_metrics"), false);
  assert.equal(pool.queries.length, 1);
  await assert.rejects(
    ensureCaseSensitiveDeviceId(pool as unknown as mysql.Pool, "other" as never),
    /unsupported device id table/
  );
});
