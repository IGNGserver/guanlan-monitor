import assert from "node:assert/strict";
import test from "node:test";
import type mysql from "mysql2/promise";
import { MysqlDeviceRepository } from "./devices.js";

interface DeviceRow {
  device_id: string;
  name: string;
  status: "open" | "closed";
  sort_order: number;
  group_name?: string | null;
  registered_at: string;
  updated_at: string;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakePool {
  readonly rows = new Map<string, DeviceRow>();
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  beforeQuery?: (sql: string) => Promise<void>;
  failure?: { pattern: string; afterWrite?: boolean };

  repository() {
    return new MysqlDeviceRepository(this as unknown as mysql.Pool);
  }

  async query(rawSql: string, params: unknown[] = []) {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    this.queries.push({ sql, params });
    await this.beforeQuery?.(sql);
    const failure = this.failure?.pattern && sql.startsWith(this.failure.pattern) ? this.failure : undefined;
    if (failure) this.failure = undefined;
    if (failure && !failure.afterWrite) throw new Error("injected SQL failure");
    const result = this.execute(sql, params);
    if (failure) throw new Error("injected SQL failure");
    return [result, []];
  }

  private execute(sql: string, params: unknown[]) {
    if (sql.startsWith("SELECT device_id AS deviceId")) {
      const row = this.rows.get(String(params[0]));
      return row && row.status === "open" ? [{
        deviceId: row.device_id,
        name: row.name,
        status: row.status,
        sortOrder: row.sort_order,
        group: row.group_name ?? null,
        registeredAt: row.registered_at,
        updatedAt: row.updated_at
      }] : [];
    }
    if (sql.startsWith("SELECT device_id, name")) {
      const row = this.rows.get(String(params[0]));
      return row ? [{ ...row }] : [];
    }
    if (sql.startsWith("SELECT COALESCE(MAX")) {
      let maxOrder = -1;
      for (const row of this.rows.values()) maxOrder = Math.max(maxOrder, row.sort_order);
      return [{ max_order: maxOrder }];
    }
    if (sql.startsWith("UPDATE devices SET name")) {
      const row = this.rows.get(String(params[2]));
      assert.ok(row);
      row.name = String(params[0]);
      row.status = "open";
      row.updated_at = String(params[1]);
    } else if (sql.startsWith("UPDATE devices SET sort_order")) {
      const row = this.rows.get(String(params[2]));
      if (row) {
        row.sort_order = Number(params[0]);
        row.updated_at = String(params[1]);
      }
    } else if (sql.startsWith("UPDATE devices SET group_name")) {
      const group = params[0] == null ? null : String(params[0]);
      const ids = params.slice(2).map(String);
      for (const id of ids) {
        const row = this.rows.get(id);
        if (row?.status === "open") {
          row.group_name = group;
          row.updated_at = String(params[1]);
        }
      }
      return { affectedRows: ids.filter((id) => this.rows.get(id)?.status === "open").length };
    } else if (sql.startsWith("INSERT INTO devices") && sql.includes("ON DUPLICATE KEY")) {
      const deviceId = String(params[0]);
      const row = this.rows.get(deviceId);
      if (row) {
        row.status = "closed";
        row.updated_at = String(params[4]);
      } else {
        this.rows.set(deviceId, {
          device_id: deviceId, name: String(params[1]), status: "closed", sort_order: 0,
          registered_at: String(params[2]), updated_at: String(params[3])
        });
      }
    } else if (sql.startsWith("INSERT INTO devices")) {
      const deviceId = String(params[0]);
      assert.ok(!this.rows.has(deviceId), "duplicate INSERT must not happen for the same key");
      this.rows.set(deviceId, {
        device_id: deviceId, name: String(params[1]), status: "open", sort_order: Number(params[2]),
        registered_at: String(params[3]), updated_at: String(params[4])
      });
    } else {
      throw new Error(`unexpected SQL: ${sql}`);
    }
    return { affectedRows: 1 };
  }
}

const fast = { skipUnchanged: true, reopenClosed: true };

test("first registration uses SQL; 100 steady samples use none and preserve timestamps", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const first = await devices.registerOrUpdateDevice("host", "Host", fast);
  assert.equal(pool.queries.length, 3);
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(await devices.registerOrUpdateDevice("host", "Host", fast), first);
  }
  assert.deepEqual(await devices.registerOrUpdateDevice("host", undefined, fast), first);
  assert.deepEqual(await devices.registerOrUpdateDevice("host", "", fast), first);
  assert.equal(pool.queries.length, 3);
});

test("name changes run the existing SELECT/UPDATE path; ordinary registrations still update", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const first = await devices.registerOrUpdateDevice("host", "Old", fast);
  const renamed = await devices.registerOrUpdateDevice("host", "New", fast);
  assert.equal(renamed.name, "New");
  assert.equal(renamed.registeredAt, first.registeredAt);
  assert.equal(pool.rows.get("host")?.name, "New");
  assert.equal(pool.queries.length, 5);
  assert.deepEqual(await devices.registerOrUpdateDevice("host", "New", fast), renamed);
  assert.equal(pool.queries.length, 5);

  pool.rows.get("host")!.updated_at = "2000-01-01 00:00:00";
  const normal = await devices.registerOrUpdateDevice("host", "New");
  assert.equal(pool.queries.length, 7);
  assert.match(pool.queries.at(-1)!.sql, /^UPDATE devices SET name/);
  assert.match(normal.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  assert.notEqual(normal.updatedAt, "2000-01-01 00:00:00");
});

test("database datetimes are normalized to ISO 8601 on every read path", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const created = await devices.registerOrUpdateDevice("host", "Host", fast);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/;
  assert.match(created.registeredAt, iso);
  assert.match(created.updatedAt, iso);

  pool.rows.set("closed-host", {
    device_id: "closed-host", name: "Closed", status: "closed", sort_order: 0,
    registered_at: "2026-01-01 00:00:00", updated_at: "2026-01-02 03:04:05"
  });
  const closed = await devices.registerOrUpdateDevice("closed-host", "Closed", { skipUnchanged: true });
  assert.equal(closed.registeredAt, "2026-01-01T00:00:00.000Z");
  assert.equal(closed.updatedAt, "2026-01-02T03:04:05.000Z");
});

test("delete invalidates an open entry; history cannot reopen it, authoritative samples can", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  await devices.registerOrUpdateDevice("host", "Host", fast);
  await devices.deleteDevice("host");
  const closed = await devices.registerOrUpdateDevice("host", "History", { skipUnchanged: true });
  assert.equal(closed.status, "closed");
  assert.equal(closed.name, "Host");
  assert.equal(pool.queries.length, 5);
  const stillClosed = await devices.registerOrUpdateDevice("host", "Host", { skipUnchanged: true });
  assert.equal(stillClosed.status, "closed");
  assert.equal(pool.queries.length, 6, "closed cache entries never take the fast path");
  const reopened = await devices.registerOrUpdateDevice("host", "Reporting", fast);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.name, "Reporting");
  assert.equal(pool.rows.get("host")?.status, "open");
  assert.equal(pool.queries.length, 8);
});

test("concurrent first samples serialize and issue exactly one INSERT", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const records = await Promise.all(Array.from({ length: 16 }, () => devices.registerOrUpdateDevice("host", "Host", fast)));
  assert.equal(pool.queries.filter(({ sql }) => sql.startsWith("INSERT")).length, 1);
  assert.equal(pool.queries.length, 3);
  for (const record of records) assert.deepEqual(record, records[0]);
});

test("registration, delete and history run in invocation order for one key", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const entered = deferred();
  const release = deferred();
  pool.beforeQuery = async (sql) => {
    if (!sql.startsWith("SELECT device_id, name")) return;
    pool.beforeQuery = undefined;
    entered.resolve();
    await release.promise;
  };
  const registering = devices.registerOrUpdateDevice("host", "Host", fast);
  await entered.promise;
  const deleting = devices.deleteDevice("host");
  const history = devices.registerOrUpdateDevice("host", "Host", { skipUnchanged: true });
  assert.equal(pool.queries.length, 1, "delete must not overtake pending registration");
  release.resolve();
  await registering;
  await deleting;
  assert.equal((await history).status, "closed");
  assert.equal(pool.rows.get("host")?.status, "closed");
});

test("failed inserts and ambiguous updates do not cache success and can be retried", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  pool.failure = { pattern: "INSERT INTO devices" };
  await assert.rejects(devices.registerOrUpdateDevice("host", "Host", fast), /injected SQL failure/);
  assert.equal(pool.rows.size, 0);
  await devices.registerOrUpdateDevice("host", "Host", fast);
  assert.equal(pool.queries.length, 6);

  pool.failure = { pattern: "UPDATE devices SET name", afterWrite: true };
  await assert.rejects(devices.registerOrUpdateDevice("host", "Changed", fast), /injected SQL failure/);
  assert.equal(pool.rows.get("host")?.name, "Changed");
  const beforeRetry = pool.queries.length;
  assert.equal((await devices.registerOrUpdateDevice("host", "Host", fast)).name, "Host");
  assert.equal(pool.queries.length, beforeRetry + 2, "old cached name cannot hide an ambiguous write");
});

test("ambiguous delete and reorder failures invalidate entries before issuing SQL", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  await devices.registerOrUpdateDevice("a", "A", fast);
  await devices.registerOrUpdateDevice("b", "B", fast);
  pool.failure = { pattern: "UPDATE devices SET sort_order", afterWrite: true };
  await assert.rejects(devices.reorderDevices(["b", "a"]), /injected SQL failure/);
  assert.equal((await devices.registerOrUpdateDevice("b", "B", fast)).sortOrder, 0);

  pool.failure = { pattern: "INSERT INTO devices", afterWrite: true };
  await assert.rejects(devices.deleteDevice("a"), /injected SQL failure/);
  assert.equal((await devices.registerOrUpdateDevice("a", "A", { skipUnchanged: true })).status, "closed");
});

test("reorder serializes behind registration and never serves stale sortOrder", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  await devices.registerOrUpdateDevice("a", "A", fast);
  await devices.registerOrUpdateDevice("b", "B", fast);
  const entered = deferred();
  const release = deferred();
  pool.beforeQuery = async (sql) => {
    if (!sql.startsWith("UPDATE devices SET name")) return;
    pool.beforeQuery = undefined;
    entered.resolve();
    await release.promise;
  };
  const registering = devices.registerOrUpdateDevice("b", "Renamed", fast);
  await entered.promise;
  const reordering = devices.reorderDevices(["b", "a"]);
  const reading = devices.registerOrUpdateDevice("b", "Renamed", fast);
  assert.equal(pool.queries.filter(({ sql }) => sql.startsWith("UPDATE devices SET sort_order")).length, 0);
  release.resolve();
  await registering;
  await reordering;
  assert.equal((await reading).sortOrder, 0);
  assert.equal((await devices.registerOrUpdateDevice("a", "A", fast)).sortOrder, 1);
  const count = pool.queries.length;
  assert.equal((await devices.registerOrUpdateDevice("b", "Renamed", fast)).sortOrder, 0);
  assert.equal(pool.queries.length, count);
});

test("returned records are clones and cannot poison the cached entry", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const first = await devices.registerOrUpdateDevice("host", "Host", fast);
  const expected = { ...first };
  first.name = "Polluted";
  first.status = "closed";
  first.sortOrder = 999;
  first.updatedAt = "bad";
  const cached = await devices.registerOrUpdateDevice("host", "Host", fast);
  assert.deepEqual(cached, expected);
  cached.name = "Also polluted";
  assert.deepEqual(await devices.registerOrUpdateDevice("host", "Host", fast), expected);
  assert.equal(pool.queries.length, 3);
});

test("successful registration cache is bounded to 4096 entries with FIFO eviction", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  for (let i = 0; i < 4_096; i++) await devices.registerOrUpdateDevice(`host-${i}`, "Host", fast);
  const beforeHit = pool.queries.length;
  await devices.registerOrUpdateDevice("host-0", "Host", fast);
  assert.equal(pool.queries.length, beforeHit);
  await devices.registerOrUpdateDevice("host-4096", "Host", fast);
  const beforeEvicted = pool.queries.length;
  await devices.registerOrUpdateDevice("host-4096", "Host", fast);
  await devices.registerOrUpdateDevice("host-1", "Host", fast);
  assert.equal(pool.queries.length, beforeEvicted);
  await devices.registerOrUpdateDevice("host-0", "Host", fast);
  assert.equal(pool.queries.length, beforeEvicted + 2, "cache hits do not refresh FIFO insertion order");
  await devices.registerOrUpdateDevice("host-1", "Host", fast);
  assert.equal(pool.queries.length, beforeEvicted + 4, "reinserting an evicted entry must evict the next oldest");
});

test("legacy VM ids are refused before SQL, cache or queue access", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  const internals = devices as unknown as { deviceQueues: unknown; registeredDevices: unknown };
  const poison = new Proxy({}, { get() { throw new Error("legacy id touched queue/cache"); } });
  internals.deviceQueues = poison;
  internals.registeredDevices = poison;
  assert.equal((await devices.registerOrUpdateDevice("vm:old", "VM", fast)).status, "closed");
  await devices.deleteDevice("vm:old");
  await devices.reorderDevices(["vm:old"]);
  await assert.rejects(devices.updateDeviceGroup(["vm:old"], "宿主机"), /device_not_found/);
  assert.equal(pool.queries.length, 0);
});

test("updateDeviceGroup invalidates cache and preserves group across subsequent registrations", async () => {
  const pool = new FakePool();
  const devices = pool.repository();
  await devices.registerOrUpdateDevice("host", "Host", fast);
  await devices.updateDeviceGroup(["host", "host"], "  宿主机  ");
  assert.equal(pool.rows.get("host")?.group_name, "宿主机");
  const afterGroup = await devices.registerOrUpdateDevice("host", "Host", fast);
  assert.equal(afterGroup.group, "宿主机");
  await assert.rejects(devices.updateDeviceGroup(["missing"], "幽灵组"), /device_not_found/);
  assert.equal(pool.rows.has("missing"), false);
});

class FakeRenamePool {
  readonly registry = new Map<string, DeviceRow>();
  readonly minute = new Set<string>();
  readonly hourly = new Set<string>();

  repository() {
    return new MysqlDeviceRepository(this as unknown as mysql.Pool);
  }

  seed(deviceId: string, name: string, extra: Partial<DeviceRow> = {}) {
    this.registry.set(deviceId, {
      device_id: deviceId, name, status: "open", sort_order: this.registry.size,
      group_name: null, registered_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00",
      ...extra
    });
  }

  async getConnection() {
    const pool = this;
    return {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      async query(sql: string, params: unknown[] = []) {
        if (sql.startsWith("SELECT device_id, name, status")) {
          const row = pool.registry.get(String(params[0]));
          return [row ? [{ ...row }] : [], []];
        }
        if (sql.startsWith("SELECT device_id FROM devices WHERE device_id = ?")) {
          const row = pool.registry.get(String(params[0]));
          return [row ? [{ device_id: row.device_id }] : [], []];
        }
        if (sql.startsWith("SELECT 1 FROM device_minute_metrics")) {
          const id = String(params[0]);
          return [[...pool.minute].some((key) => key === id || key.startsWith(`${id}:`)) ? [{ present: 1 }] : [], []];
        }
        if (sql.startsWith("SELECT 1 FROM device_hourly_metrics")) {
          const id = String(params[0]);
          return [[...pool.hourly].some((key) => key === id || key.startsWith(`${id}:`)) ? [{ present: 1 }] : [], []];
        }
        if (sql.startsWith("UPDATE devices SET device_id")) {
          const [next, updatedAt, old] = params.map(String);
          const row = pool.registry.get(old);
          assert.ok(row);
          row.device_id = next;
          row.updated_at = updatedAt;
          pool.registry.delete(old);
          pool.registry.set(next, row);
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith("UPDATE device_minute_metrics")) {
          const [next, old] = params.map(String);
          for (const key of [...pool.minute]) {
            if (key !== old && !key.startsWith(`${old}:`)) continue;
            pool.minute.delete(key);
            pool.minute.add(key.replace(old, next));
          }
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith("UPDATE device_hourly_metrics")) {
          const [next, old] = params.map(String);
          for (const key of [...pool.hourly]) {
            if (key !== old && !key.startsWith(`${old}:`)) continue;
            pool.hourly.delete(key);
            pool.hourly.add(key.replace(old, next));
          }
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }
    };
  }
}

test("renameDevice moves the registry row, history and timestamps", async () => {
  const pool = new FakeRenamePool();
  const devices = pool.repository();
  pool.seed("old", "NAS2", { sort_order: 4, group_name: "宿主机" });
  pool.minute.add("old:2026-11-18 10:00:00");
  pool.hourly.add("old:2026-11-18 10:00:00");
  const renamed = await devices.renameDevice("old", "NAS2");
  assert.equal(renamed.deviceId, "NAS2");
  assert.equal(renamed.name, "NAS2");
  assert.equal(renamed.sortOrder, 4);
  assert.equal(renamed.group, "宿主机");
  assert.match(renamed.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  assert.equal(pool.registry.has("old"), false);
  assert.ok(pool.registry.has("NAS2"));
  assert.ok(pool.minute.has("NAS2:2026-11-18 10:00:00"));
  assert.ok(pool.hourly.has("NAS2:2026-11-18 10:00:00"));
});

test("renameDevice refuses an existing id or orphaned history", async () => {
  const pool = new FakeRenamePool();
  const devices = pool.repository();
  pool.seed("old", "Old");
  pool.seed("taken", "Taken");
  await assert.rejects(devices.renameDevice("old", "taken"), /device_id_conflict/);
  pool.minute.add("orphan:2026-11-18 10:00:00");
  await assert.rejects(devices.renameDevice("old", "orphan"), /device_id_conflict/);
  await assert.rejects(devices.renameDevice("missing", "next"), /device_not_found/);
  assert.ok(pool.registry.has("old"));
});
