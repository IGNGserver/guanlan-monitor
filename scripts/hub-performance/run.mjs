import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { counterDelta, normalizeStats, readContainerStats } from './engine-stats.mjs';
import { sanitizeDiagnostic } from './diagnostics.mjs';
import { browserSmoke } from './browser-smoke.mjs';
import { verifyStaticWeb } from './static-web.mjs';
import { resourceEvidenceStatus } from './report.mjs';
import { createHubContractPayload } from '../../apps/server/src/hub-contract-fixtures.ts';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const composeFile = join(root, 'deploy/performance/compose.yml');
const services = ['web', 'server', 'redis', 'mysql'];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export function validateOptions(options, environment = process.env) {
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'ci_only');
  assert.match(options.side ?? '', /^(base|head)$/, 'invalid_side');
  assert.match(options.sha ?? '', /^[a-f0-9]{40}$/, 'invalid_sha');
  const project = `glperf-${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}-${options.side}`;
  assert.match(project, /^glperf-\d+-\d+-(base|head)$/, 'invalid_project');
  assert.ok(options.output && resolve(options.output) !== root, 'invalid_output');
  return { ...options, project };
}

export function cookieFromHeaders(headers) {
  const cookies = headers.getSetCookie();
  const session = cookies.find((value) => value.startsWith('dsc_session='));
  if (!session) throw new Error('session_cookie_missing');
  return session.split(';', 1)[0];
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function publicOrigin(portOutput) {
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(portOutput);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('non_loopback_port');
  return `http://127.0.0.1:${match[1]}`;
}

// A fixed, synthetic fixture: no host inventory, command lines or production data.
export function payload(device, sequence, timestamp) {
  const result = createHubContractPayload({ deviceId: `perf-${device}`, timestamp,
    hardware: { disks: 2, networkInterfaces: 2, gpus: 1, fans: 2, temperatureSensors: 2 } });
  result.sampleId = `perf-${device}-${sequence}`;
  result.cpuUsagePercent = 20 + sequence % 60;
  result.networkRate.totalRxBytes = sequence * 10000;
  result.networkRate.totalTxBytes = sequence * 5000;
  for (const nic of result.networkInterfaces) {
    nic.totalRxBytes = sequence * 5000;
    nic.totalTxBytes = sequence * 2500;
  }
  return result;
}

export async function waitForReadiness(request, {
  now = () => performance.now(), wait = pause, timeoutMs = 90000, requestTimeoutMs = 2000,
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const { body } = await request('/api/health/readiness', {},
        Math.max(1, Math.ceil(Math.min(requestTimeoutMs, deadline - now()))));
      if (now() < deadline && JSON.parse(body).status === 'ready') return;
    } catch { /* Only loopback synthetic readiness is retried. */ }
    if (now() < deadline) await wait(Math.min(1000, deadline - now()));
  }
  throw new Error('readiness_timeout');
}

// One missed cadence is a load-shape failure, not a performance regression gate.
export async function scheduledWorkload(durationMs, rate, operation, {
  now = () => performance.now(), wait = pause, maxConcurrency = 4,
  maxLatenessMs = rate ? 1000 / rate : 0,
} = {}) {
  const started = now(), deadline = started + durationMs;
  const scheduled = Math.ceil(durationMs * rate / 1000);
  const latency = [], delays = [], active = new Set();
  let completed = 0, failed = 0, skipped = 0, late = 0, bytes = 0;
  for (let index = 0; index < scheduled; index++) {
    const planned = started + index * 1000 / rate;
    await wait(Math.max(0, planned - now()));
    const began = now(), delay = Math.max(0, began - planned);
    delays.push(delay);
    if (began >= deadline) { skipped += scheduled - index; late += scheduled - index; break; }
    if (delay > maxLatenessMs) { skipped++; late++; continue; }
    if (active.size >= maxConcurrency) { skipped++; continue; }
    const task = (async () => {
      try {
        const result = await operation(index);
        completed++; bytes += result.bytes; latency.push(now() - began);
      } catch { failed++; }
    })().finally(() => active.delete(task));
    active.add(task);
  }
  // Keep the declared measurement window even when the final request is fast.
  if (now() < deadline) await wait(deadline - now());
  await Promise.all(active);
  const distribution = (values) => ({ p50: percentile(values, .5), p95: percentile(values, .95),
    max: values.length ? Math.max(...values) : null });
  return { durationMs, rate, maxLatenessMs, scheduled, completed, failed, skipped, late,
    responseBytes: bytes, latencyMs: distribution(latency), schedulingDelayMs: distribution(delays) };
}

export function summarizeResources(before, samples, after) {
  const snapshots = [before, ...samples, after];
  const resources = Object.fromEntries(services.map((service) => {
    const readings = snapshots.map((sample) => sample[service]);
    const valid = (value) => Number.isSafeInteger(value) && value >= 0;
    const values = readings.map((reading) => reading?.memoryBytes).filter(valid);
    const delta = counterDelta(before[service], after[service]);
    const incomplete = [...delta.incomplete, ...readings.flatMap((reading) => [
      ...(reading?.incomplete ?? []),
      ...(!valid(reading?.cpuNs) ? ['cpuNs:unavailable'] : []),
      ...(!valid(reading?.memoryBytes) ? ['memoryBytes:unavailable'] : []),
    ])];
    return [service, { ...delta,
      sampledMemoryMaxBytes: values.length ? Math.max(...values) : null,
      sampledMemoryMeanBytes: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      incomplete: [...new Set(incomplete)] }];
  }));
  const alignedMemory = snapshots.filter((sample) => services.every((service) =>
    Number.isSafeInteger(sample[service]?.memoryBytes) && sample[service].memoryBytes >= 0))
    .map((sample) => services.reduce((sum, service) => sum + sample[service].memoryBytes, 0));
  return { resources, sampledStackMemoryMaxBytes: alignedMemory.length ? Math.max(...alignedMemory) : null };
}

export function validateQueryResponse(path, body, { oldBucket } = {}) {
  const check = (valid) => { if (!valid) throw new Error('invalid_business_response'); };
  let data;
  try { data = JSON.parse(body); } catch { check(false); }
  const url = new URL(path, 'http://127.0.0.1');
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const points = (values) => Array.isArray(values) && values.length > 0
    && values.every((point) => date(point?.timestamp) && finite(point?.value));
  const fleet = (values) => Array.isArray(values) && values.length === 12
    && new Set(values.map((value) => value?.deviceId)).size === 12
    && values.every((value) => /^perf-(?:[0-9]|1[01])$/.test(value?.deviceId));
  if (url.pathname === '/api/devices') {
    check(fleet(data) && data.every((device) => finite(device.cpuUsagePercent)));
  } else if (url.pathname === '/api/devices/perf-0') {
    check(data?.deviceId === 'perf-0' && finite(data.cpuUsagePercent));
  } else if (url.pathname === '/api/devices/perf-0/metrics') {
    check(data?.device?.deviceId === 'perf-0' && data.window === url.searchParams.get('window')
      && finite(data.latest?.cpuUsagePercent) && points(data.series?.cpuUsagePercent));
    if (data.window === '1h' && oldBucket) {
      check(data.series.cpuUsagePercent.some((point) => Date.parse(point.timestamp) === oldBucket.timestamp
        && point.value === oldBucket.value));
    }
  } else if (url.pathname === '/api/overview/metrics') {
    check(data?.window === url.searchParams.get('window') && fleet(data.instances)
      && data.instances.every((instance) => points(instance.cpuUsagePercent)));
  } else if (url.pathname === '/api/devices/perf-0/traffic-calendar') {
    check(data?.mode === url.searchParams.get('mode') && date(data.rangeStart) && date(data.rangeEnd)
      && finite(data.totalRxBytes) && data.totalRxBytes >= 0 && finite(data.totalTxBytes) && data.totalTxBytes >= 0
      && Array.isArray(data.cells) && data.cells.length > 0 && data.cells.every((cell) =>
        date(cell?.rangeStart) && date(cell?.rangeEnd) && finite(cell?.totalRxBytes) && finite(cell?.totalTxBytes))
      && Array.isArray(data.records) && data.records.every((record) => date(record?.timestamp)
        && finite(record?.rxBytes) && finite(record?.txBytes) && finite(record?.totalBytes)));
  } else check(false);
  return data;
}

async function run(input) {
  const options = validateOptions(input);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  const privateDir = await mkdtemp(join(tmpdir(), 'glperf-private-'));
  const envFile = join(privateDir, 'synthetic.env');
  const accessKey = randomBytes(24).toString('hex');
  const image = (service) => `glperf-${service}-${options.side}:${options.sha}`;
  const variables = {
    PERF_SERVER_IMAGE: image('server'), PERF_WEB_IMAGE: image('web'), PERF_APP_VERSION: 'dev',
    PERF_SESSION_SECRET: randomBytes(32).toString('hex'), PERF_ACCESS_KEY: accessKey,
    PERF_REDIS_PASSWORD: randomBytes(24).toString('hex'), PERF_MYSQL_PASSWORD: randomBytes(24).toString('hex'),
    PERF_MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex')
  };
  await writeFile(envFile, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
  const compose = async (...args) => {
    try {
      return (await exec('docker', ['compose', '--env-file', envFile, '-f', composeFile, '-p', options.project, ...args],
        { timeout: 180000, maxBuffer: 1024 * 1024 })).stdout.trim();
    } catch (error) {
      throw Object.assign(new Error('compose_command_failed'), {
        diagnostic: sanitizeDiagnostic(`${error.stdout ?? ''}\n${error.stderr ?? ''}`, Object.values(variables))
      });
    }
  };
  const report = {
    schemaVersion: 1, side: options.side, sha: options.sha, status: 'incomplete',
    scope: 'isolated synthetic CI smoke; not production or a long-running soak',
    harnessSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url)))
      .update(await readFile(composeFile)).update(await readFile(new URL('./engine-stats.mjs', import.meta.url)))
      .update(await readFile(new URL('./report.mjs', import.meta.url)))
      .update(await readFile(new URL('./browser-smoke.mjs', import.meta.url)))
      .update(await readFile(new URL('./static-web.mjs', import.meta.url)))
      .update(await readFile(new URL('../../apps/server/src/hub-contract-fixtures.ts', import.meta.url))).digest('hex'),
    environment: { platform: process.platform, arch: process.arch, logicalCpus: cpus().length, node: process.version },
    phases: [], evidence: {}, failures: [], cleanup: false
  };
  let containers = {};
  let cookie = '';
  try {
    report.environment.docker = (await exec('docker', ['version', '--format', '{{.Server.Version}}'])).stdout.trim();
    report.environment.compose = (await exec('docker', ['compose', 'version', '--short'])).stdout.trim();
    await compose('up', '-d', '--no-build');
    const origin = publicOrigin(await compose('port', 'web', '3000'));
    for (const service of services) {
      const id = await compose('ps', '-q', service);
      assert.match(id, /^[a-f0-9]{64}$/, 'missing_container');
      const { stdout } = await exec('docker', ['inspect', '--format', '{{json .Config.Labels}}', id]);
      const labels = JSON.parse(stdout);
      assert.equal(labels['com.docker.compose.project'], options.project, 'foreign_container');
      assert.equal(labels['com.docker.compose.service'], service, 'foreign_service');
      if (service === 'web') report.evidence.webRuntime = labels['io.guanlan.web-runtime'] ?? 'next-standalone';
      containers[service] = id;
      report.evidence[`${service}ImageId`] = (await exec('docker', ['inspect', '--format', '{{.Image}}', id])).stdout.trim();
    }
    const request = async (path, init = {}, timeoutMs = 15000) => {
      const response = await fetch(`${origin}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(cookie ? { cookie } : {}), ...init.headers }
      });
      const body = await response.text();
      if (!response.ok) throw new Error('business_request_failed');
      return { response, body, bytes: Buffer.byteLength(body) };
    };
    await waitForReadiness(request);
    if (report.evidence.webRuntime === 'static-nginx') {
      await compose('exec', '-T', 'web', 'sh', '-c', '! command -v node && nginx -t');
      report.evidence.staticWeb = await verifyStaticWeb(origin, accessKey);
    }
    const login = await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessKey })
    });
    cookie = cookieFromHeaders(login.response.headers);
    await request('/api/auth/session');
    assert.match((await request('/')).body, /<html/i, 'web_document_missing');
    const ingest = async (device, sequence, timestamp) => {
      const result = await request('/api/agent/ingest', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessKey}` },
        body: JSON.stringify(payload(device, sequence, timestamp))
      });
      assert.equal(JSON.parse(result.body).ok, true);
      return result;
    };
    const seedNow = Date.now();
    // Each device is strictly ordered; crossing buckets exercises real history writes.
    for (let device = 0; device < 12; device++) {
      for (let sample = 0; sample < 18; sample++) {
        await ingest(device, sample + 1, seedNow - (19 - sample) * 5 * 60000);
      }
      await ingest(device, 100, Date.now() - 2000);
    }
    // The final historical sample was flushed by the current-time sample. A
    // current in-memory aggregate alone cannot prove this known old SQL bucket.
    const oldBucket = { timestamp: Math.floor((seedNow - 10 * 60000) / 60000) * 60000,
      value: payload(0, 18, seedNow - 10 * 60000).cpuUsagePercent };
    const query = async (path) => {
      const result = await request(path);
      validateQueryResponse(path, result.body, { oldBucket });
      return result;
    };
    await query('/api/devices');
    await query('/api/devices/perf-0/metrics?window=1h');
    report.evidence.oldMinuteBucket = oldBucket;

    const snapshot = async () => Object.fromEntries(await Promise.all(services.map(async (service) => {
      try { return [service, normalizeStats(await readContainerStats(containers[service]))]; }
      catch { return [service, { cpuNs: null, memoryBytes: null, readBytes: null, writeBytes: null, incomplete: ['stats_unavailable'] }]; }
    })));
    const phase = async (name, durationMs, rate, operation) => {
      const samples = [];
      const before = await snapshot();
      const started = performance.now();
      let stopped = false;
      const sampler = (async () => {
        while (!stopped) { samples.push(await snapshot()); if (!stopped) await pause(1000); }
      })();
      let workload;
      try {
        workload = await scheduledWorkload(durationMs, rate, operation);
      } finally {
        stopped = true;
        await sampler;
      }
      const elapsedMs = performance.now() - started;
      const after = await snapshot();
      const entry = { name, elapsedMs, ...workload, ...summarizeResources(before, samples, after) };
      report.phases.push(entry);
      if (workload.failed || workload.skipped) throw new Error('workload_incomplete');
      if (resourceEvidenceStatus([entry]) === 'incomplete') throw new Error('required_stats_unavailable');
    };
    await phase('idle-with-agents', 5000, 0, async () => ({ bytes: 0 }));
    await phase('ingest', 20000, 12, (index) => ingest(index % 12, 200 + index, Date.now()));
    const latest = JSON.parse((await query('/api/devices/perf-0/metrics?window=5m')).body);
    assert.equal(latest.latest.cpuUsagePercent, payload(0, 428, Date.now()).cpuUsagePercent, 'ingest_was_ignored');
    const paths = ['/api/devices', '/api/devices/perf-0',
      '/api/devices/perf-0/metrics?window=5m&pointBudget=120',
      '/api/devices/perf-0/metrics?window=1h&pointBudget=120',
      '/api/overview/metrics?window=5m&pointBudget=120',
      `/api/devices/perf-0/traffic-calendar?mode=day&anchor=${encodeURIComponent(new Date().toISOString())}`];
    await phase('queries', 20000, 10, (index) => query(paths[index % paths.length]));
    // Read-only persistence evidence, not an alternate business ingestion path.
    const counts = await compose('exec', '-T', 'mysql', 'sh', '-c',
      'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM device_minute_metrics; SELECT COUNT(*) FROM device_hourly_metrics;"');
    const numbers = counts.split(/\s+/).map(Number);
    assert.ok(numbers.length === 2 && numbers.every((value) => Number.isSafeInteger(value) && value > 0), 'history_persistence_missing');
    Object.assign(report.evidence, { minuteRows: numbers[0], hourlyRows: numbers[1], devices: 12, seededSamples: 228 });
    // UI parity is deliberately after resource measurement. The old baseline
    // has the known long-session timer bug, so this is a candidate correctness
    // gate, not an extra asymmetric performance workload.
    if (options.side === 'head' && process.env.GLPERF_PLAYWRIGHT_MODULE) {
      report.evidence.browser = await browserSmoke({ origin, accessKey, modulePath: process.env.GLPERF_PLAYWRIGHT_MODULE,
        pauseOrigin: () => compose('stop', 'web'), resumeOrigin: () => compose('start', 'web'),
        onStage: (stage) => { (report.evidence.browserProgress ??= []).push(stage); } });
    }
    if (report.evidence.webRuntime === 'static-nginx') {
      // Separate post-measurement TLS boundary exercise. Trust only container
      // loopback, not the runner's public-port peer, and enable the real HTTPS
      // guard. Cookie Secure is a separate explicit setting, not protocol proof.
      variables.PERF_REQUIRE_HTTPS = 'true';
      variables.PERF_TRUSTED_TLS_PROXY_CIDRS = '127.0.0.1/32';
      await writeFile(envFile, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
      await compose('up', '-d', '--no-build', '--force-recreate', 'server', 'web');
      const tlsOrigin = publicOrigin(await compose('port', 'web', '3000'));
      await waitForReadiness(async (path, init, timeoutMs) => {
        const response = await fetch(`${tlsOrigin}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        return { body: await response.text() };
      });
      const sample = JSON.stringify(payload(0, 600, Date.now()));
      const spoofed = await fetch(`${tlsOrigin}/api/agent/ingest`, { method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${accessKey}`, 'content-type': 'application/json',
          'x-forwarded-proto': 'https', forwarded: 'proto=https' }, body: sample });
      assert.equal(spoofed.status, 400, 'untrusted_https_spoof_accepted');
      assert.equal((await spoofed.json()).error, 'https_required', 'wrong_https_boundary_rejection');
      const accepted = await compose('exec', '-T', 'web', 'wget', '-qO-',
        '--header=Content-Type: application/json', `--header=Authorization: Bearer ${accessKey}`,
        '--header=X-Forwarded-Proto: https', `--post-data=${sample}`, 'http://127.0.0.1:3000/api/agent/ingest');
      assert.equal(JSON.parse(accepted).ok, true, 'trusted_tls_ingress_rejected');
      report.evidence.tlsBoundary = { httpsRequired: true, untrustedSpoofRejected: true, trustedIngressAccepted: true };
      for (const service of ['web', 'server']) containers[service] = await compose('ps', '-q', service);
      // Recovery assertions apply only to already persisted historical buckets
      // and accepted latest/raw data; this is not a power-loss or full-hour
      // unflushed aggregate durability claim, nor a long-running soak.
      const recoveredRead = async (path, init = {}, timeoutMs = 5000) => {
        const response = await fetch(`${tlsOrigin}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs),
          headers: { cookie, ...init.headers } });
        assert.ok(response.ok, 'recovery_request_failed');
        return { body: await response.text() };
      };
      const acceptedTimestamp = JSON.parse(sample).timestamp;
      const recoveries = [];
      for (const service of ['server', 'redis', 'mysql']) {
        const started = performance.now();
        if (service === 'server') {
          await compose('kill', '-s', 'SIGKILL', 'server');
          await compose('start', 'server');
        } else await compose('restart', service);
        await waitForReadiness(recoveredRead);
        const metrics = JSON.parse((await recoveredRead('/api/devices/perf-0/metrics?window=5m')).body);
        assert.equal(metrics.lastSeenAt, acceptedTimestamp, 'accepted_latest_lost_after_restart');
        validateQueryResponse('/api/devices/perf-0/metrics?window=1h',
          (await recoveredRead('/api/devices/perf-0/metrics?window=1h')).body, { oldBucket });
        recoveries.push({ service, elapsedMs: performance.now() - started,
          acceptedLatestPreserved: true, oldHistoricalBucketPreserved: true });
      }
      report.evidence.recovery = recoveries;
    }
    for (const service of services) {
      const { stdout } = await exec('docker', ['inspect', '--format', '{{json .State}}', containers[service]]);
      const state = JSON.parse(stdout);
      assert.ok(state.Running && !state.OOMKilled && state.ExitCode === 0, 'container_unhealthy');
    }
    report.status = resourceEvidenceStatus(report.phases);
    if (report.status === 'incomplete') throw new Error('required_stats_unavailable');
  } catch (error) {
    const safeCodes = new Set(['readiness_timeout', 'workload_incomplete', 'history_persistence_missing',
      'business_request_failed', 'invalid_business_response', 'compose_command_failed', 'container_unhealthy', 'session_cookie_missing', 'required_stats_unavailable',
      'native_upgrade_failed', 'native_upgrade_auth_boundary_failed', 'native_upgrade_protocol_failed']);
    report.failures.push(safeCodes.has(error.message) ? error.message : 'functional_or_measurement_failure');
    if (error.diagnostic) report.diagnostic = error.diagnostic;
    if (Number.isInteger(error.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) report.failureStatus = error.statusCode;
  } finally {
    try {
      await compose('down', '--volumes', '--remove-orphans');
      const { stdout } = await exec('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${options.project}`]);
      const volumes = await exec('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${options.project}`]);
      report.cleanup = !stdout.trim() && !volumes.stdout.trim();
      if (!report.cleanup) report.failures.push('cleanup_incomplete');
    } catch { report.failures.push('cleanup_failed'); }
    await rm(privateDir, { recursive: true, force: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = Object.fromEntries(args.reduce((pairs, arg, index) => index % 2 ? pairs : [...pairs, [arg.replace(/^--/, ''), args[index + 1]]], []));
  run(options).catch(() => { console.error('hub_performance_setup_failed'); process.exitCode = 1; });
}
