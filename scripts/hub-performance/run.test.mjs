import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieFromHeaders, payload, percentile, publicOrigin, scheduledWorkload, summarizeResources,
  validateOptions, validateQueryResponse, waitForReadiness } from './run.mjs';
import { comparison, markdown, relativeChange, resourceEvidenceStatus } from './report.mjs';

test('the benchmark cannot target production names, ports, credentials or revisions', () => {
  const options = { side: 'base', sha: 'a'.repeat(40), output: '/synthetic/report.json' };
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  assert.equal(validateOptions(options, env).project, 'glperf-123-1-base');
  for (const override of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_RUN_ID: 'production' }, { GITHUB_RUN_ATTEMPT: '../' }]) {
    assert.throws(() => validateOptions(options, { ...env, ...override }));
  }
  for (const override of [{ side: 'production' }, { sha: 'main' }, { output: undefined }]) {
    assert.throws(() => validateOptions({ ...options, ...override }, env));
  }
  assert.equal(publicOrigin('127.0.0.1:49152\n'), 'http://127.0.0.1:49152');
  for (const port of ['0.0.0.0:38472', '[::]:3000', '127.0.0.1:0', '127.0.0.1:65536', 'https://hub.invalid']) {
    assert.throws(() => publicOrigin(port));
  }
});

test('cookie extraction never treats Expires commas or attributes as cookies', () => {
  const headers = new Headers();
  headers.append('set-cookie', 'other=1; Path=/');
  headers.append('set-cookie', 'dsc_session=synthetic; Expires=Thu, 01 Jan 2027 00:00:00 GMT; HttpOnly; Path=/');
  assert.equal(cookieFromHeaders(headers), 'dsc_session=synthetic');
  assert.throws(() => cookieFromHeaders(new Headers()), /session_cookie_missing/);
});

test('workloads are deterministic, nonempty and increment cumulative traffic', () => {
  const now = Date.now();
  const before = payload(1, 20, now), after = payload(1, 21, now + 1000);
  assert.deepEqual(before, payload(1, 20, now));
  assert.equal(before.identity.deviceId, 'perf-1');
  for (const key of ['disks', 'networkInterfaces', 'gpus', 'fans', 'temperatureSensors']) assert.ok(before[key].length);
  assert.ok(after.networkRate.totalRxBytes > before.networkRate.totalRxBytes);
  assert.equal(before.networkRate.totalRxBytes, before.networkInterfaces.reduce((sum, nic) => sum + nic.totalRxBytes, 0));
  assert.equal(percentile([], .95), null);
  assert.equal(percentile([4, 1, 2, 3], .5), 2);
});

test('comparison cannot turn missing evidence, zero denominators or a different harness into a pass', () => {
  assert.equal(relativeChange(0, 1), null);
  assert.equal(relativeChange(null, 1), null);
  assert.equal(relativeChange(100, 80), -20);
  const base = { side: 'base', sha: 'a'.repeat(40), harnessSha256: 'same', status: 'complete', failures: [], cleanup: true,
    phases: [{ name: 'idle', resources: {}, sampledStackMemoryMaxBytes: 100 }] };
  const head = { ...base, side: 'head', sha: 'b'.repeat(40) };
  assert.equal(comparison(null, head).status, 'incomplete');
  assert.equal(comparison(base, { ...head, cleanup: false }).status, 'incomplete');
  assert.equal(comparison(base, { ...head, harnessSha256: 'different' }).status, 'incomplete');
  assert.match(markdown(null, head), /incomplete/);
  assert.match(markdown(base, head), /N\/A/);
});

const services = ['web', 'server', 'redis', 'mysql'];
function snapshot(cpuNs = 100) {
  return Object.fromEntries(services.map((service) => [service,
    { cpuNs, memoryBytes: 200, readBytes: 10, writeBytes: 20, incomplete: [] }]));
}
function resourcePhase(before = snapshot(), samples = [snapshot(150)], after = snapshot(200)) {
  return { name: 'idle', ...summarizeResources(before, samples, after) };
}

test('required CPU and memory evidence cannot disappear at either boundary or during sampling', () => {
  assert.equal(resourceEvidenceStatus([resourcePhase()]), 'complete');
  for (const service of services) for (const metric of ['cpuNs', 'memoryBytes']) {
    for (const position of [0, 1, 2]) {
      const readings = [snapshot(), snapshot(150), snapshot(200)];
      // Even an incomplete list missing its diagnostic must not hide a null scalar.
      readings[position][service][metric] = null;
      const phase = resourcePhase(readings[0], [readings[1]], readings[2]);
      assert.equal(resourceEvidenceStatus([phase]), 'incomplete', `${service}/${metric}/${position}`);
      assert.ok(phase.resources[service].incomplete.includes(`${metric}:unavailable`));
    }
  }
  const missing = snapshot(150);
  missing.web = { cpuNs: null, memoryBytes: null, readBytes: null, writeBytes: null, incomplete: ['stats_unavailable'] };
  assert.equal(resourceEvidenceStatus([resourcePhase(snapshot(), [missing])]), 'incomplete');
});

test('only unavailable block counters permit partial evidence; memory remains a gauge', () => {
  const before = snapshot(), middle = snapshot(150), after = snapshot(200);
  before.web.memoryBytes = 300;
  after.web.memoryBytes = 100;
  for (const reading of [before, middle, after]) {
    reading.redis.readBytes = null;
    reading.redis.writeBytes = null;
    reading.redis.incomplete = ['readBytes:empty', 'writeBytes:empty'];
  }
  const phase = resourcePhase(before, [middle], after);
  assert.equal(resourceEvidenceStatus([phase]), 'partial-resource-evidence');
  assert.equal(phase.resources.web.cpuNs, 100);
  assert.equal(phase.resources.web.sampledMemoryMeanBytes, 200);
  assert.equal(phase.resources.web.sampledMemoryMaxBytes, 300);
  assert.equal(phase.sampledStackMemoryMaxBytes, 900);
  assert.equal(phase.resources.redis.readBytes, null);
  phase.resources.server.incomplete.push('unrecognized_failure');
  assert.equal(resourceEvidenceStatus([phase]), 'incomplete');
});

test('comparison rejects required-resource diagnostics and incomplete reports even with numeric aggregates', () => {
  const base = { side: 'base', sha: 'a'.repeat(40), harnessSha256: 'same', status: 'complete',
    failures: [], cleanup: true, phases: [resourcePhase()] };
  const head = { ...structuredClone(base), side: 'head' };
  assert.equal(comparison(base, head).status, 'complete');
  head.status = 'incomplete';
  assert.equal(comparison(base, head).status, 'incomplete');
  head.status = 'partial-resource-evidence';
  head.phases[0].resources.web.incomplete = ['cpuNs:missing'];
  assert.equal(comparison(base, head).status, 'incomplete');
  head.phases[0].resources.web.incomplete = ['memoryBytes:missing'];
  assert.equal(comparison(base, head).status, 'incomplete');
  head.phases[0].resources.web.incomplete = ['writeBytes:empty'];
  head.phases[0].resources.web.writeBytes = null;
  assert.equal(comparison(base, head).status, 'partial-resource-evidence');
  for (const reason of ['writeBytes:decreased', 'writeBytes:invalid']) {
    head.phases[0].resources.web.incomplete = [reason];
    assert.equal(comparison(base, head).status, 'incomplete');
  }
});

function clock() {
  let time = 0;
  return { now: () => time, wait: async (ms) => { time += ms; }, advance: (ms) => { time += ms; } };
}

test('readiness uses one wall-clock deadline and caps each request to the remaining budget', async () => {
  const timer = clock(), budgets = [];
  await assert.rejects(waitForReadiness(async (path, init, timeoutMs) => {
    assert.equal(path, '/api/health/readiness');
    assert.deepEqual(init, {});
    budgets.push(timeoutMs);
    timer.advance(timeoutMs);
    throw new Error('synthetic_timeout');
  }, { ...timer, timeoutMs: 4500 }), /readiness_timeout/);
  assert.deepEqual(budgets, [2000, 1500]);
  assert.equal(timer.now(), 4500);
});

test('readiness accepts ready JSON only before its deadline, not invalid or late responses', async () => {
  const timer = clock();
  const bodies = ['<html>', '{"status":"not_ready"}', '{"status":"ready"}'];
  await waitForReadiness(async () => ({ body: bodies.shift() }), { ...timer, timeoutMs: 5000 });
  assert.equal(timer.now(), 2000);
  assert.equal(bodies.length, 0);
  await assert.rejects(waitForReadiness(async () => {
    timer.advance(1000);
    return { body: '{"status":"ready"}' };
  }, { ...timer, timeoutMs: 1000 }), /readiness_timeout/);
});

test('fixed-rate scheduling preserves the full window and request/byte counts', async () => {
  const timer = clock(), starts = [];
  const result = await scheduledWorkload(1000, 10, async () => {
    starts.push(timer.now());
    return { bytes: 7 };
  }, timer);
  assert.deepEqual(starts, Array.from({ length: 10 }, (_, index) => index * 100));
  assert.equal(timer.now(), 1000);
  assert.equal(result.scheduled, 10);
  assert.equal(result.completed, 10);
  assert.equal(result.responseBytes, 70);
  assert.equal(result.failed + result.skipped + result.late, 0);
  assert.equal(result.schedulingDelayMs.max, 0);
  const idle = await scheduledWorkload(5000, 0, () => assert.fail('idle must not send traffic'), timer);
  assert.equal(timer.now(), 6000);
  assert.equal(idle.scheduled, 0);
});

test('stalled schedules skip overdue slots and never launch beyond the phase deadline', async () => {
  for (const stall of [450, 1100]) {
    const timer = clock(), indexes = [];
    const result = await scheduledWorkload(1000, 10, async (index) => {
      indexes.push(index);
      if (index === 0) timer.advance(stall);
      return { bytes: 1 };
    }, timer);
    assert.deepEqual(indexes, stall === 450 ? [0, 4, 5, 6, 7, 8, 9] : [0]);
    assert.equal(result.scheduled, result.completed + result.failed + result.skipped);
    assert.equal(result.skipped, stall === 450 ? 3 : 9);
    assert.equal(result.late, result.skipped);
    assert.ok(result.schedulingDelayMs.max > result.maxLatenessMs);
  }
});

test('concurrency saturation and rejected or synchronous operations cannot count as completions', async () => {
  const timer = clock(), pending = [];
  const result = await scheduledWorkload(1000, 10, () => new Promise((done) => pending.push(done)), {
    ...timer,
    wait: async (ms) => {
      timer.advance(ms);
      if (timer.now() >= 1000) for (const done of pending) done({ bytes: 3 });
    },
  });
  assert.equal(pending.length, 4);
  assert.equal(result.completed, 4);
  assert.equal(result.skipped, 6);
  assert.equal(result.responseBytes, 12);
  const failed = await scheduledWorkload(1000, 2, (index) => {
    if (!index) throw new Error('synthetic_sync_failure');
    return Promise.reject(new Error('synthetic_async_failure'));
  }, clock());
  assert.equal(failed.failed, 2);
  assert.equal(failed.completed, 0);
});

function queryFixtures() {
  const timestamp = '2026-10-24T12:00:00.000Z';
  const point = { timestamp, value: 38 };
  const devices = Array.from({ length: 12 }, (_, index) => ({ deviceId: `perf-${index}`, cpuUsagePercent: 38 }));
  const metrics = (window) => ({ device: devices[0], window, latest: { cpuUsagePercent: 38 },
    series: { cpuUsagePercent: [point] } });
  const calendar = { mode: 'day', rangeStart: timestamp, rangeEnd: timestamp, totalRxBytes: 0, totalTxBytes: 0,
    cells: [{ rangeStart: timestamp, rangeEnd: timestamp, totalRxBytes: 0, totalTxBytes: 0 }], records: [] };
  return [
    ['/api/devices', devices],
    ['/api/devices/perf-0', devices[0]],
    ['/api/devices/perf-0/metrics?window=5m&pointBudget=120', metrics('5m')],
    ['/api/devices/perf-0/metrics?window=1h&pointBudget=120', metrics('1h')],
    ['/api/overview/metrics?window=5m&pointBudget=120', { window: '5m', instances: devices.map((device) =>
      ({ deviceId: device.deviceId, cpuUsagePercent: [point] })) }],
    ['/api/devices/perf-0/traffic-calendar?mode=day&anchor=2026-10-24', calendar],
  ];
}

test('all six query paths validate JSON semantics rather than accepting any 200 body', () => {
  for (const [path, data] of queryFixtures()) {
    assert.deepEqual(validateQueryResponse(path, JSON.stringify(data)), data);
    for (const bad of ['{}', 'null', '[]', '<html>', '{"error":"synthetic"}']) {
      assert.throws(() => validateQueryResponse(path, bad), /invalid_business_response/, path);
    }
  }
  const fixtures = queryFixtures();
  fixtures[0][1][0].deviceId = 'perf-1'; // Duplicate ID must not hide a missing device.
  fixtures[1][1] = { deviceId: 'wrong', cpuUsagePercent: 38 };
  fixtures[2][1].window = '1h';
  fixtures[3][1].series.cpuUsagePercent = [];
  fixtures[4][1].instances[0].cpuUsagePercent = [];
  fixtures[5][1].records = [{ timestamp: 'invalid', rxBytes: 0, txBytes: 0, totalBytes: 0 }];
  for (const [path, data] of fixtures) assert.throws(() => validateQueryResponse(path, JSON.stringify(data)),
    /invalid_business_response/, path);
});

test('historical reads must contain the known old bucket and its seeded value, not just a current overlay', () => {
  const [path, data] = queryFixtures()[3];
  const oldBucket = { timestamp: Date.parse(data.series.cpuUsagePercent[0].timestamp), value: 38 };
  assert.deepEqual(validateQueryResponse(path, JSON.stringify(data), { oldBucket }), data);
  data.series.cpuUsagePercent[0].timestamp = '2026-10-24T12:10:00.000Z';
  assert.throws(() => validateQueryResponse(path, JSON.stringify(data), { oldBucket }), /invalid_business_response/);
  data.series.cpuUsagePercent[0] = { timestamp: new Date(oldBucket.timestamp).toISOString(), value: 39 };
  assert.throws(() => validateQueryResponse(path, JSON.stringify(data), { oldBucket }), /invalid_business_response/);
});

test('semantic response failures are counted as failed query workload operations', async () => {
  const result = await scheduledWorkload(1000, 2, async () => {
    validateQueryResponse('/api/devices', '{}');
    return { bytes: 2 };
  }, clock());
  assert.equal(result.scheduled, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.completed, 0);
  assert.equal(result.responseBytes, 0);
});
