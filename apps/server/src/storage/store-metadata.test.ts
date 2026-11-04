import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { MysqlStoreMetadata } from "./store-metadata.js";

function fakePool(initial?: string) {
  let stored = initial;
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("SELECT meta_value")) {
        return [[{ meta_value: stored }], []];
      }
      if (sql.includes("VALUES ('instance_id'") && params) {
        stored ??= String(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 0 }, []];
    }
  } as unknown as mysql.Pool;
  return pool;
}

test("metadata records the first instance id idempotently", async () => {
  const pool = fakePool();
  await new MysqlStoreMetadata(pool, "hub-a").initialize();
  await new MysqlStoreMetadata(pool, "hub-a").initialize();
});

test("metadata refuses a database owned by another instance id", async () => {
  const pool = fakePool("hub-a");
  await assert.rejects(new MysqlStoreMetadata(pool, "hub-b").initialize(), /belongs to instance "hub-a"/);
});

test("writer lock refuses a second owner and releases the held connection", async () => {
  let acquired = 0;
  let released = false;
  const connection = {
    async query(query: string | { sql: string }) {
      const sql = typeof query === "string" ? query : query.sql;
      if (sql.includes("GET_LOCK")) return [[{ acquired }], []];
      if (sql.includes("RELEASE_LOCK")) { released = true; return [[{ released: 1 }], []]; }
      return [[], []];
    },
    release() {}
  };
  const pool = { getConnection: async () => connection } as unknown as mysql.Pool;
  const metadata = new MysqlStoreMetadata(pool, "hub-a", { writerLock: true });
  acquired = 0;
  await assert.rejects(metadata.acquireWriterLock(), /Another Hub process/);
  acquired = 1;
  await metadata.acquireWriterLock();
  await metadata.releaseWriterLock();
  assert.equal(released, true);
});
