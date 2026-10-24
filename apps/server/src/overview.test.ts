import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { DeviceMetricKey, MetricSeries, MetricWindow } from "@dsc/shared";
import { createHubContractPayload } from "./hub-contract-fixtures.js";
import { overviewToMetricSeries, projectOverviewRecord, type OverviewSeries } from "./overview.js";
import { mapHistoryRow } from "./repositories/history.js";
import { averageRecord, MetricsService } from "./services/metrics.js";
import type { MetricAccumulator, Repositories, TimeSeriesRecord } from "./types.js";
import { ALL_DEVICE_METRIC_KEYS, payloadToTimeSeries, timeSeriesToMetricSeries } from "./utils.js";
import { registerRoutes } from "./routes.js";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { budgetSeries } from "./series-budget.js";

const fields = ["cpuUsagePercent", "memoryUsedBytes", "diskUsedBytes", "networkRxBytesPerSec", "networkTxBytesPerSec"] as const;
const metrics: DeviceMetricKey[] = ["cpuUsage", "memoryUsage", "diskUsage", "networkRxRate", "networkTxRate"];
const start = Date.parse("2026-10-24T00:00:00Z");
const record = (offset = 0) => payloadToTimeSeries(createHubContractPayload({ timestamp: start + offset }));
const pick = (series: MetricSeries): OverviewSeries => Object.fromEntries(fields.map((field) => [field, series[field]])) as OverviewSeries;

// Independent copy of the existing route's bucket behavior, not the new helper.
function legacy(points: TimeSeriesRecord[], window: MetricWindow = "5m") {
  const series = pick(timeSeriesToMetricSeries(points));
  const bucket = ["1m", "5m"].includes(window) ? 0 : ["15m", "1h", "6h", "24h", "1d"].includes(window) ? 60_000 : 3_600_000;
  if (bucket) for (const field of fields) {
    const aligned = new Map<number, { timestamp: string; value: number }>();
    for (const point of series[field]) {
      const timestamp = Math.floor(Date.parse(point.timestamp) / bucket) * bucket;
      aligned.set(timestamp, { timestamp: new Date(timestamp).toISOString(), value: point.value });
    }
    series[field] = [...aligned.entries()].sort((a, b) => a[0] - b[0]).map(([, point]) => point);
  }
  return series;
}

function golden(points: TimeSeriesRecord[], window: MetricWindow = "5m") {
  const actual = overviewToMetricSeries(points.map(projectOverviewRecord), window);
  assert.deepEqual(actual, legacy(points, window));
  return actual;
}

test("overview matches all five old curves for every window/alias, bucket collisions, gaps and peaks", () => {
  const points = [0, 2_000, 58_000, 60_000, 3_600_000, 9 * 3_600_000].map((offset) => record(offset));
  points[1].cpuUsagePercent = 100;
  points[2].networkRxBytesPerSec = 1_000_000;
  points[2].networkTxBytesPerSec = 2_000_000;
  for (const window of ["1m", "5m", "15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"] as const) golden(points, window);
  assert.equal(golden(points).cpuUsagePercent[1].value, 100);
  assert.equal(golden(points).networkRxBytesPerSec[2].value, 1_000_000);
});

test("overview preserves per-metric missing quality and valid direct/derived zero, including old agents", () => {
  const points = [record(), record(2_000), record(4_000), record(6_000), record(8_000), record(10_000)];
  const states = ["unavailable", "not_applicable", "stale", "direct", "derived"] as const;
  for (const [i, state] of states.entries()) {
    const point = points[i];
    point.cpuUsagePercent = point.memoryUsedBytes = point.diskUsedBytes = point.networkRxBytesPerSec = point.networkTxBytesPerSec = 0;
    point.recordedDetails!.memory.usedBytes = 0;
    point.disks = point.disks!.map((disk) => ({ ...disk, usedBytes: 0 }));
    point.recordedDetails!.metricQuality = Object.fromEntries(metrics.map((key) => [key, { state }]));
  }
  const series = golden(points);
  for (const field of fields) {
    assert.deepEqual(series[field].map((point) => point.timestamp), [6_000, 8_000, 10_000].map((offset) => new Date(start + offset).toISOString()));
    assert.equal(series[field][0].value, 0);
    assert.equal(series[field][1].value, 0);
  }
  points[5].recordedDetails!.unavailableMetrics = ["memoryUsage", "networkTxRate"];
  const unavailable = golden(points);
  assert.equal(unavailable.memoryUsedBytes.length, 2);
  assert.equal(unavailable.networkTxBytesPerSec.length, 2);
  assert.equal(unavailable.cpuUsagePercent.length, 3);
});

test("overview retains the old observation timestamp gate, including a valid shared observation", () => {
  const points = [record(), record(2_000), record(4_000)];
  points[1].recordedDetails!.metricQuality = { cpuUsage: { state: "stale", observedAt: new Date(start).toISOString() } };
  assert.equal(golden(points).cpuUsagePercent.length, 1);
  points[0].recordedDetails!.metricQuality = { cpuUsage: { state: "direct", observedAt: new Date(start).toISOString() } };
  assert.equal(golden(points).cpuUsagePercent.length, 2);
});

test("overview keeps old JSON capacities, absent fields, empty and nonempty all-zero disk precedence", () => {
  const source = record();
  const old = mapHistoryRow({ ...source, memoryUsedBytes: undefined, diskUsedBytes: undefined,
    recordedDetailsJson: JSON.stringify(source.recordedDetails), diskInstancesJson: "[]", gpuInstancesJson: "[]" });
  const expectedDisk = source.recordedDetails!.disks!.reduce((total, disk) => total + disk.usedBytes, 0);
  assert.equal(golden([old]).memoryUsedBytes[0].value, source.recordedDetails!.memory.usedBytes);
  assert.equal(golden([old]).diskUsedBytes[0].value, expectedDisk);
  old.disks = [{ id: "empty", name: "empty", usedBytes: 0 }, { id: "missing", name: "missing" }];
  assert.equal(golden([old]).diskUsedBytes[0].value, 0, "nonempty all-zero instances must not fall back to detail disks");
  old.disks = [{ id: "a", name: "a", usedBytes: 7 }, { id: "b", name: "b", usedBytes: 11 }];
  assert.equal(golden([old]).diskUsedBytes[0].value, 18);
  old.diskUsedBytes = 42;
  old.memoryUsedBytes = 24;
  assert.equal(golden([old]).diskUsedBytes[0].value, 42);
  assert.equal(golden([old]).memoryUsedBytes[0].value, 24);
  const noDetails = mapHistoryRow({ ...source, memoryUsedBytes: undefined, diskUsedBytes: undefined, recordedDetailsJson: null, diskInstancesJson: null, gpuInstancesJson: null });
  assert.equal(golden([noDetails]).memoryUsedBytes[0].value, 0);
  assert.equal(golden([noDetails]).diskUsedBytes[0].value, 0);
});

test("overview does not derive rates from reset counters or change config-era capacity fallbacks", () => {
  const points = [record(), record(2_000), record(4_000)];
  for (const [i, point] of points.entries()) {
    point.trafficRxBytes = [1_000_000, 0, 30][i];
    point.trafficTxBytes = [0, 99_000_000, 0][i];
    point.networkRxBytesPerSec = i * 10;
    point.networkTxBytesPerSec = i * 20;
  }
  assert.deepEqual(golden(points).networkRxBytesPerSec.map((point) => point.value), [0, 10, 20]);
  const disabled = payloadToTimeSeries(createHubContractPayload(), { enabledMetrics: ALL_DEVICE_METRIC_KEYS.filter((key) => !metrics.includes(key)) });
  golden([disabled]);
  assert.ok(projectOverviewRecord(disabled).memoryUsedBytes > 0, "preserve the legacy JSON capacity fallback even with disabled numeric placeholders");
});

test("overview preserves aggregate quality gaps rather than averages diluted by missing observations", () => {
  const first = record();
  const second = record(2_000);
  second.recordedDetails!.metricQuality = { memoryUsage: { state: "stale" }, networkRxRate: { state: "unavailable" } };
  const series = golden([averageRecord([first, second], start)]);
  assert.deepEqual(series.memoryUsedBytes, []);
  assert.deepEqual(series.networkRxBytesPerSec, []);
  assert.equal(series.cpuUsagePercent.length, 1);
});

test("overview service uses projected history and exactly the existing live filtering/current-bucket merge for all windows", async (t) => {
  t.mock.method(Date, "now", () => start + 42_000);
  const history = [record(-3_600_000), record(-60_000), record()];
  const live = [record(-6 * 60_000), record(-2 * 60_000), record(2_000)];
  const configs = { get: async () => null, set: async () => {} };
  const calls: MetricWindow[] = [];
  const fallback = new MetricsService({
    realtime: { readSeries: async () => live }, history: { getHistoricalSeries: async () => history }
  } as unknown as Repositories, () => {}, configs);
  const projected = new MetricsService({
    realtime: { readSeries: async () => live }, history: {
      getHistoricalSeries: async () => { throw new Error("overview must not read full history"); },
      getOverviewSeries: async (_id: string, window: MetricWindow) => { calls.push(window); return history.map(projectOverviewRecord); }
    }
  } as unknown as Repositories, () => {}, configs);
  for (const service of [fallback, projected]) {
    const internals = service as unknown as { minuteAccumulators: Map<string, MetricAccumulator>; hourlyAccumulators: Map<string, MetricAccumulator> };
    const missing = record(20_000);
    missing.recordedDetails!.unavailableMetrics = ["networkTxRate"];
    internals.minuteAccumulators.set("node", { bucketStartedAt: start, samples: [record(10_000), missing] });
    internals.hourlyAccumulators.set("node", { bucketStartedAt: start, samples: [record(10_000), missing] });
  }
  for (const window of ["1m", "5m", "15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"] as const) {
    const full = await fallback.getSeries("node", window);
    const expected = legacy(full, window);
    assert.deepEqual(overviewToMetricSeries(await projected.getOverviewSeries("node", window), window), expected, window);
    assert.deepEqual(overviewToMetricSeries(await fallback.getOverviewSeries("node", window), window), expected, `fallback ${window}`);
    if (window === "1m") assert.equal(full.length, 1);
    else if (window === "5m") assert.equal(full.length, 2);
    else assert.equal(full.filter((point) => point.timestamp === start).length, 1);
  }
  assert.equal(calls.length, 11);
  const empty = new MetricsService({ history: { getOverviewSeries: async () => history.map(projectOverviewRecord) } } as unknown as Repositories, () => {}, configs);
  assert.deepEqual(await empty.getOverviewSeries("node", "1h"), history.map(projectOverviewRecord));
});

test("actual overview HTTP route uses only five-series projection and keeps budgets, gaps and paired rates", async () => {
  const app = Fastify();
  const payload = createHubContractPayload();
  const points = Array.from({ length: 160 }, (_, i) => {
    const point = record(i * 2_000 + (i >= 80 ? 120_000 : 0));
    point.cpuUsagePercent = i === 40 ? 100 : 5;
    point.networkRxBytesPerSec = i === 90 ? 100_000 : i;
    point.networkTxBytesPerSec = i === 90 ? 200_000 : i * 2;
    if (i === 70) point.recordedDetails!.unavailableMetrics = ["memoryUsage"];
    return point;
  });
  const state = { identity: payload.identity, latest: payload, lastSeenAt: payload.timestamp, status: "online" as const };
  const repositories = { realtime: { listDevices: async () => [state] } } as unknown as Repositories;
  const configs = { get: async () => null, set: async () => {} };
  const service = new MetricsService(repositories, () => {}, configs);
  service.getOverviewSeries = async () => points.map(projectOverviewRecord);
  service.getSeries = async () => { throw new Error("overview must not use the full-series path"); };
  service.getMetricConfig = async () => { throw new Error("the five overview fields do not use the detail converter/config"); };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, service, { metricConfigs: configs, fanNotes: { get: async () => ({}), set: async () => {} } });
  await app.ready();
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const headers = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  try {
    for (const window of ["1m", "5m", "15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"] as const) {
      const expected = { deviceId: payload.identity.deviceId, hostname: payload.identity.hostname, ...legacy(points, window), unavailableMetrics: [] };
      for (const budget of [undefined, 16]) {
        const response = await app.inject({ url: `/api/overview/metrics?window=${window}${budget ? `&pointBudget=${budget}` : ""}`, headers });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(response.json(), { window, instances: budgetSeries([expected], budget),
          ...(budget ? { sampling: { method: "minmax-v1", targetPoints: budget } } : {}) });
      }
    }
  } finally { await app.close(); }
});

test("overview uses narrow inventory and bounded workers while preserving inventory order", async () => {
  const app = Fastify();
  const summaries = Array.from({ length: 33 }, (_, index) => ({ deviceId: `node-${index}`, hostname: `Host ${index}` }));
  const repositories = { realtime: {
    listSummaries: async () => summaries,
    listDevices: async () => { throw new Error("full hardware inventory must not be read"); }
  } } as unknown as Repositories;
  const configs = { get: async () => null, set: async () => {} };
  const service = new MetricsService(repositories, () => {}, configs);
  let active = 0, maximum = 0;
  service.getOverviewSeries = async () => {
    active++; maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    return [];
  };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, service, { metricConfigs: configs, fanNotes: { get: async () => ({}), set: async () => {} } });
  await app.ready();
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  try {
    const response = await app.inject({ url: "/api/overview/metrics", headers: { cookie: `dsc_session=${encodeURIComponent(signed)}` } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(maximum, 4);
    assert.deepEqual(response.json().instances.map((entry: { deviceId: string }) => entry.deviceId), summaries.map((entry) => entry.deviceId));
  } finally { await app.close(); }
});
