import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type mysql from "mysql2/promise";
import { buildDeviceSummaries, registerInventoryRecovery } from "./inventory-recovery.js";
import { MysqlHistoryRepository } from "./repositories/history.js";
import { buildTrafficCalendar, trafficCalendarBounds } from "./traffic-calendar.js";
import { MetricsService } from "./services/metrics.js";
import { createHubContractPayload } from "./hub-contract-fixtures.js";
import { toSummary } from "./utils.js";
import { overviewToMetricSeries } from "./overview.js";
import type { DeviceRecord, MetricAccumulator, Repositories, TrafficHistoryPoint, TimeSeriesRecord } from "./types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const record = (deviceId: string, sortOrder = 0): DeviceRecord => ({ deviceId, name: deviceId, status: "open", sortOrder, registeredAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });

test("device lists never read historical discovery and retain offline registry order", async () => {
  const app = Fastify();
  const repositories = {
    devices: { listOpenDevices: async () => [record("b", 2), record("a", 1)] },
    realtime: { listDevices: async () => [] },
    history: { listKnownDevices: async () => { throw Error("history is unavailable"); } }
  } as unknown as Repositories;
  try {
    for (let i = 0; i < 10; i++) {
      const devices = await buildDeviceSummaries(repositories, app.log);
      assert.deepEqual(devices.map((device) => device.deviceId), ["a", "b"]);
      assert.equal(devices[0].status, "offline");
      assert.equal(devices[0].cpuUsagePercent, null);
    }
  } finally { await app.close(); }
});

test("narrow device lists never deserialize full realtime hardware states", async () => {
  const app = Fastify();
  const payload = createHubContractPayload({ deviceId: "narrow", timestamp: Date.now() });
  const summary = toSummary({ identity: payload.identity, latest: payload, status: "online", lastSeenAt: payload.timestamp });
  const repositories = {
    devices: { listOpenDevices: async () => [record("narrow", 3)] },
    realtime: {
      listSummaries: async () => [summary],
      listDevices: async () => { throw new Error("full hardware scan is forbidden"); }
    }
  } as unknown as Repositories;
  try {
    assert.deepEqual(await buildDeviceSummaries(repositories, app.log), [{ ...summary, sortOrder: 3 }]);
  } finally { await app.close(); }
});

test("inventory projection preserves the original registration hostname without exposing its private field", async () => {
  const app = Fastify();
  const payload = createHubContractPayload({ deviceId: "workstation", timestamp: Date.now() });
  const state = { identity: payload.identity, latest: payload, status: "online" as const, lastSeenAt: payload.timestamp };
  const summary = { ...toSummary(state), registrationHostname: "original-host" };
  const repositories = {
    devices: {
      listOpenDevices: async () => [],
      registerOrUpdateDevice: async (_id: string, name: string) => {
        assert.equal(name, "original-host");
        return record("workstation");
      }
    }, realtime: { listSummaries: async () => [summary] }
  } as unknown as Repositories;
  try {
    const [result] = await buildDeviceSummaries(repositories, app.log);
    assert.equal(result.hostname, "工作站");
    assert.equal("registrationHostname" in result, false);
  } finally { await app.close(); }
});

test("offline scans drain bounded expiry pages in one sweep and never scan all hardware", async () => {
  const payload = createHubContractPayload({ timestamp: Date.now() });
  const lastSeenAt = new Date(Date.now() - 60_000).toISOString();
  const states = Array.from({ length: 257 }, (_, index) => ({
    identity: { ...payload.identity, deviceId: `expired-${index}` }, latest: payload, status: "online" as const, lastSeenAt
  }));
  let scans = 0, marked = 0, active = 0, maximum = 0;
  const service = new MetricsService({ realtime: {
    listDevices: async () => { throw new Error("full hardware scan is forbidden"); },
    listExpiredDevices: async (cutoff: number) => {
      assert.ok(cutoff >= Date.parse(lastSeenAt));
      const page = states.slice(scans * 128, ++scans * 128);
      return page;
    },
    markOfflineIfMatch: async () => {
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--; marked++;
      return true;
    }
  } } as unknown as Repositories, () => {}, { get: async () => null, set: async () => {} });
  await service.markOfflineDevices();
  assert.equal(marked, 257);
  assert.equal(scans, 4);
  assert.ok(maximum <= 8);
});

test("concurrent identical history reads share SQL only until settlement, with no stale TTL cache", async () => {
  const read = deferred<TimeSeriesRecord[]>();
  let calls = 0;
  const service = new MetricsService({ history: {
    getHistoricalSeries: async () => { calls++; return calls === 1 ? read.promise : []; }
  } } as unknown as Repositories, () => {}, { get: async () => null, set: async () => {} });
  const first = service.getSeries("node", "1h");
  const second = service.getSeries("node", "1h");
  await Promise.resolve();
  assert.equal(calls, 1);
  read.resolve([]);
  assert.deepEqual(await Promise.all([first, second]), [[], []]);
  await service.getSeries("node", "1h");
  assert.equal(calls, 2);
});

test("background history discovery does not hold listen or lists and never reopens closed records", async () => {
  const app = Fastify();
  const history = deferred<Array<{ deviceId: string; lastSeenAt: string }>>();
  const finished = deferred<void>();
  const attempts: string[] = [];
  const open = [record("registered")];
  const repositories = {
    devices: {
      listOpenDevices: async () => [...open],
      registerOrUpdateDevice: async (id: string, _name: string, options?: unknown) => {
        assert.equal(options, undefined, "recovery never passes reopenClosed");
        attempts.push(id);
        if (id !== "closed") open.push(record(id));
        if (id === "closed") finished.resolve();
        return { ...record(id), status: id === "closed" ? "closed" : "open" };
      }
    },
    realtime: { listDevices: async () => [] },
    history: { listKnownDevices: () => history.promise }
  } as unknown as Repositories;
  registerInventoryRecovery(app, repositories);
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    assert.equal((await buildDeviceSummaries(repositories, app.log)).length, 1);
    history.resolve(["registered", "historical", "closed"].map((deviceId) => ({ deviceId, lastSeenAt: "2026-01-01T00:00:00Z" })));
    await finished.promise;
    assert.deepEqual(attempts, ["historical", "closed"]);
    assert.deepEqual((await buildDeviceSummaries(repositories, app.log)).map((device) => device.deviceId), ["historical", "registered"]);
  } finally { history.resolve([]); await app.close(); }
});

test("closing the Hub fences a still-pending inventory recovery", async () => {
  const app = Fastify();
  const history = deferred<Array<{ deviceId: string; lastSeenAt: string }>>();
  let registrations = 0;
  const repositories = {
    devices: { listOpenDevices: async () => [], registerOrUpdateDevice: async () => { registrations++; return record("late"); } },
    history: { listKnownDevices: () => history.promise }
  } as unknown as Repositories;
  registerInventoryRecovery(app, repositories);
  await app.listen({ host: "127.0.0.1", port: 0 });
  await app.close();
  history.resolve([{ deviceId: "late", lastSeenAt: "2026-01-01T00:00:00Z" }]);
  await new Promise((done) => setImmediate(done));
  assert.equal(registrations, 0);
});

test("failed inventory discovery retries in the background and stops after success", async () => {
  const app = Fastify();
  const recovered = deferred<void>();
  let reads = 0;
  const repositories = {
    devices: {
      listOpenDevices: async () => [],
      registerOrUpdateDevice: async () => { recovered.resolve(); return record("recovered"); }
    },
    history: { listKnownDevices: async () => {
      if (++reads === 1) throw Error("transient fixture failure");
      return [{ deviceId: "recovered", lastSeenAt: "2026-01-01T00:00:00Z" }];
    } }
  } as unknown as Repositories;
  registerInventoryRecovery(app, repositories, 1);
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    await recovered.promise;
    assert.equal(reads, 2);
  } finally { await app.close(); }
});

test("calendar bounds retain every visible cell across leap days, year edges and counter resets", () => {
  const start = Date.parse("2023-12-01T00:00:00Z");
  const points: TrafficHistoryPoint[] = Array.from({ length: 900 }, (_, i) => ({ timestamp: start + i * 12 * 3600_000, trafficRxBytes: (i % 47) * 1024, trafficTxBytes: (i % 53) * 2048 }));
  for (const mode of ["day", "week", "month"] as const) {
    for (const anchor of ["2024-02-29T12:00:00Z", "2024-12-31T20:00:00Z", "2025-01-01T00:00:00Z"]) {
      const bounds = trafficCalendarBounds(mode, anchor);
      const full = buildTrafficCalendar(points, mode, anchor);
      assert.equal(bounds.start, Date.parse(full.cells[0].rangeStart));
      assert.equal(bounds.end, Date.parse(full.cells.at(-1)!.rangeEnd));
      const projected = points.filter((point) => point.timestamp >= bounds.start && point.timestamp < bounds.end);
      assert.deepEqual(buildTrafficCalendar(projected, mode, anchor), full);
      const selected = full.cells[0].rangeStart;
      assert.deepEqual(buildTrafficCalendar(projected, mode, anchor, selected), buildTrafficCalendar(points, mode, anchor, selected));
    }
  }
});

test("MySQL calendar reads only counters with bound range parameters", async () => {
  const calls: Array<{ sql: string; params: unknown }> = [];
  const pool = { query: async (sql: string, params: unknown) => {
    calls.push({ sql, params });
    return [[{ timestamp: "1000", trafficRxBytes: "20", trafficTxBytes: "30" }]];
  } } as unknown as mysql.Pool;
  const history = new MysqlHistoryRepository(pool);
  assert.deepEqual(await history.getTrafficSeries("node", 1000, 2000), [{ timestamp: 1000, trafficRxBytes: 20, trafficTxBytes: 30 }]);
  assert.deepEqual(calls[0].params, ["node", 1000, 2000]);
  assert.match(calls[0].sql, /recorded_at < FROM_UNIXTIME/);
  assert.doesNotMatch(calls[0].sql, /json|cpu_|memory_|SELECT\s+\*/i);
  await history.listKnownDevices();
  assert.equal((calls[1].sql.match(/GROUP BY device_id/g) ?? []).length, 3);
});

test("calendar service uses projection and preserves current hour/minute counter overlays", async () => {
  const now = Date.now();
  const hour = Math.floor(now / 3600_000) * 3600_000;
  const minute = Math.floor(now / 60_000) * 60_000;
  const anchor = new Date(now).toISOString();
  const expectedBounds = trafficCalendarBounds("day", anchor);
  const historyPoints = [{ timestamp: hour, trafficRxBytes: 1, trafficTxBytes: 2 }];
  const repositories = { history: {
    getHistoricalSeries: async () => { throw Error("must not read full hardware history"); },
    getTrafficSeries: async (id: string, start: number, end: number) => {
      assert.equal(id, "node"); assert.deepEqual({ start, end }, expectedBounds);
      return historyPoints;
    }
  } } as unknown as Repositories;
  const service = new MetricsService(repositories, () => {}, { get: async () => null, set: async () => {} });
  const internals = service as unknown as { hourlyAccumulators: Map<string, MetricAccumulator>; minuteAccumulators: Map<string, MetricAccumulator> };
  internals.hourlyAccumulators.set("node", { bucketStartedAt: hour, samples: [{ timestamp: now, trafficRxBytes: 100, trafficTxBytes: 200 } as TimeSeriesRecord] });
  internals.minuteAccumulators.set("node", { bucketStartedAt: minute, samples: [{ timestamp: now, trafficRxBytes: 120, trafficTxBytes: 240 } as TimeSeriesRecord] });
  const expected = [{ timestamp: hour, trafficRxBytes: 100, trafficTxBytes: 200 }].filter((point) => point.timestamp !== minute);
  expected.push({ timestamp: minute, trafficRxBytes: 120, trafficTxBytes: 240 });
  assert.deepEqual(await service.getTrafficCalendar("node", "day", anchor), buildTrafficCalendar(expected, "day", anchor));
});

test("MySQL overview selects only numeric fields and JSON paths with the original table/range for every window", async () => {
  const calls: Array<{ sql: string; params: unknown }> = [];
  const pool = { query: async (sql: string, params: unknown) => {
    calls.push({ sql, params });
    return [[{ timestamp: "1000", cpuUsagePercent: "0", networkRxBytesPerSec: "12", networkTxBytesPerSec: "0",
      memoryUsedJson: "1024", diskUsedValuesJson: "[0,7,null,11]",
      metricQualityJson: '{"cpuUsage":{"state":"direct"},"networkRxRate":{"state":"stale"}}',
      unavailableMetricsJson: '["diskUsage"]' }]];
  } } as unknown as mysql.Pool;
  const history = new MysqlHistoryRepository(pool);
  for (const window of ["1m", "5m"] as const) assert.deepEqual(await history.getOverviewSeries("node", window), []);
  assert.equal(calls.length, 0);
  const cases = [
    ["15m", "minute", "MINUTE", 15], ["1h", "minute", "MINUTE", 60], ["6h", "minute", "MINUTE", 360],
    ["24h", "minute", "MINUTE", 1440], ["1d", "minute", "MINUTE", 1440],
    ["7d", "hourly", "HOUR", 168], ["1w", "hourly", "HOUR", 168],
    ["30d", "hourly", "HOUR", 744], ["1mo", "hourly", "HOUR", 744],
    ["90d", "hourly", "HOUR", 2160], ["1y", "hourly", "HOUR", 8784]
  ] as const;
  for (const [window, table, unit, range] of cases) {
    const points = await history.getOverviewSeries("node", window);
    const call = calls.at(-1)!;
    assert.deepEqual(call.params, ["node", range]);
    assert.match(call.sql, new RegExp(`FROM device_${table}_metrics`));
    assert.match(call.sql, new RegExp(`recorded_at >= DATE_SUB\\(UTC_TIMESTAMP\\(\\), INTERVAL \\? ${unit}\\)`));
    assert.match(call.sql, /ORDER BY recorded_at ASC/);
    assert.match(call.sql, /JSON_EXTRACT\(recorded_details_json, '\$\.memory\.usedBytes'\)/);
    assert.match(call.sql, /JSON_TYPE\(disk_instances_json\) = 'ARRAY' AND JSON_LENGTH\(disk_instances_json\) > 0/);
    assert.match(call.sql, /JSON_EXTRACT\(disk_instances_json, '\$\[\*\]\.usedBytes'\)/);
    assert.match(call.sql, /JSON_EXTRACT\(recorded_details_json, '\$\.disks\[\*\]\.usedBytes'\)/);
    assert.doesNotMatch(call.sql, /SELECT\s+\*|(?:recorded_details_json|disk_instances_json|gpu_instances_json)\s+AS\b|\bLIMIT\b|\bAVG\s*\(/i);
    assert.equal(points[0].memoryUsedBytes, 1024);
    assert.equal(points[0].diskUsedBytes, 18);
    assert.equal("recordedDetails" in points[0], false);
    assert.deepEqual(overviewToMetricSeries(points).cpuUsagePercent, [{ timestamp: "1970-01-01T00:00:01.000Z", value: 0 }]);
    assert.deepEqual(overviewToMetricSeries(points).diskUsedBytes, []);
    assert.deepEqual(overviewToMetricSeries(points).networkRxBytesPerSec, []);
  }
});

test("MySQL overview normalizes native and serialized JSON scalars, arrays and old missing paths", async () => {
  const variants = [
    { memoryUsedJson: null, diskUsedValuesJson: null, metricQualityJson: null, unavailableMetricsJson: null },
    { memoryUsedJson: "null", diskUsedValuesJson: "[]", metricQualityJson: "{}", unavailableMetricsJson: "[]" },
    { memoryUsedJson: 0, diskUsedValuesJson: [0, null], metricQualityJson: { cpuUsage: { state: "derived" } }, unavailableMetricsJson: [] },
    { memoryUsedJson: '"1024"', diskUsedValuesJson: '["3",0,4]', metricQualityJson: "{}", unavailableMetricsJson: "[]" }
  ];
  const pool = { query: async () => [variants.map((variant, index) => ({ timestamp: index * 1000, cpuUsagePercent: 0,
    networkRxBytesPerSec: 0, networkTxBytesPerSec: 0, ...variant }))] } as unknown as mysql.Pool;
  const points = await new MysqlHistoryRepository(pool).getOverviewSeries("node", "1h");
  assert.deepEqual(points.map((point) => point.memoryUsedBytes), [0, 0, 0, 1024]);
  assert.deepEqual(points.map((point) => point.diskUsedBytes), [0, 0, 0, 7]);
  assert.equal(overviewToMetricSeries(points).cpuUsagePercent.length, 4);
});
