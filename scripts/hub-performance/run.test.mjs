import assert from 'node:assert/strict';
import test from 'node:test';
import { cookieFromHeaders, payload, percentile, publicOrigin, validateOptions } from './run.mjs';
import { comparison, markdown, relativeChange } from './report.mjs';

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
