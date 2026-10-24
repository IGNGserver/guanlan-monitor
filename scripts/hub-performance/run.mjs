import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { counterDelta, normalizeStats, readContainerStats } from './engine-stats.mjs';
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
    } catch { throw new Error('compose_command_failed'); }
  };
  const report = {
    schemaVersion: 1, side: options.side, sha: options.sha, status: 'incomplete',
    scope: 'isolated synthetic CI smoke; not production or a long-running soak',
    harnessSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url)))
      .update(await readFile(composeFile)).update(await readFile(new URL('./engine-stats.mjs', import.meta.url)))
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
      containers[service] = id;
      report.evidence[`${service}ImageId`] = (await exec('docker', ['inspect', '--format', '{{.Image}}', id])).stdout.trim();
    }
    const request = async (path, init = {}) => {
      const response = await fetch(`${origin}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { ...(cookie ? { cookie } : {}), ...init.headers }
      });
      const body = await response.text();
      if (!response.ok) throw new Error('business_request_failed');
      return { response, body, bytes: Buffer.byteLength(body) };
    };
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const { body } = await request('/api/health/readiness');
        ready = JSON.parse(body).status === 'ready';
        if (ready) break;
      } catch { /* Only loopback synthetic readiness is retried. */ }
      await pause(1000);
    }
    if (!ready) throw new Error('readiness_timeout');
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
    assert.equal(JSON.parse((await request('/api/devices')).body).length, 12, 'device_set_mismatch');
    const metrics = JSON.parse((await request('/api/devices/perf-0/metrics?window=1h')).body);
    assert.equal(metrics.device.deviceId, 'perf-0');
    assert.ok(metrics.series.cpuUsagePercent.length > 0, 'history_missing');

    const snapshot = async () => Object.fromEntries(await Promise.all(services.map(async (service) => {
      try { return [service, normalizeStats(await readContainerStats(containers[service]))]; }
      catch { return [service, { cpuNs: null, memoryBytes: null, readBytes: null, writeBytes: null, incomplete: ['stats_unavailable'] }]; }
    })));
    const phase = async (name, durationMs, rate, operation) => {
      const samples = [];
      const latency = [];
      const active = new Set();
      let scheduled = 0, completed = 0, failed = 0, skipped = 0, bytes = 0;
      const before = await snapshot();
      const started = performance.now();
      let stopped = false;
      const sampler = (async () => {
        while (!stopped) { samples.push(await snapshot()); if (!stopped) await pause(1000); }
      })();
      try {
        if (!rate) await pause(durationMs);
        else for (let index = 0; index < durationMs * rate / 1000; index++) {
          await pause(Math.max(0, started + index * 1000 / rate - performance.now()));
          scheduled++;
          if (active.size >= 4) { skipped++; continue; }
          const began = performance.now();
          const task = operation(index).then((result) => {
            completed++; bytes += result.bytes; latency.push(performance.now() - began);
          }, () => { failed++; }).finally(() => active.delete(task));
          active.add(task);
        }
        await Promise.all(active);
      } finally {
        stopped = true;
        await sampler;
      }
      const elapsedMs = performance.now() - started;
      const after = await snapshot();
      const resources = Object.fromEntries(services.map((service) => {
        const values = samples.map((sample) => sample[service].memoryBytes).filter((value) => value !== null);
        return [service, { ...counterDelta(before[service], after[service]),
          sampledMemoryMaxBytes: values.length ? Math.max(...values) : null,
          sampledMemoryMeanBytes: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
          incomplete: [...new Set([...counterDelta(before[service], after[service]).incomplete,
            ...samples.flatMap((sample) => sample[service].incomplete)])] }];
      }));
      const alignedMemory = samples.map((sample) => services.every((service) => sample[service].memoryBytes !== null)
        ? services.reduce((sum, service) => sum + sample[service].memoryBytes, 0) : null).filter((value) => value !== null);
      report.phases.push({ name, elapsedMs, scheduled, completed, failed, skipped, responseBytes: bytes,
        latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95), max: latency.length ? Math.max(...latency) : null },
        sampledStackMemoryMaxBytes: alignedMemory.length ? Math.max(...alignedMemory) : null, resources });
      if (failed || skipped) throw new Error('workload_incomplete');
    };
    await phase('idle-with-agents', 5000, 0, async () => ({ bytes: 0 }));
    await phase('ingest', 20000, 12, (index) => ingest(index % 12, 200 + index, Date.now()));
    const latest = JSON.parse((await request('/api/devices/perf-0/metrics?window=5m')).body);
    assert.equal(latest.latest.cpuUsagePercent, payload(0, 428, Date.now()).cpuUsagePercent, 'ingest_was_ignored');
    const paths = ['/api/devices', '/api/devices/perf-0',
      '/api/devices/perf-0/metrics?window=5m&pointBudget=120',
      '/api/devices/perf-0/metrics?window=1h&pointBudget=120',
      '/api/overview/metrics?window=5m&pointBudget=120',
      `/api/devices/perf-0/traffic-calendar?mode=day&anchor=${encodeURIComponent(new Date().toISOString())}`];
    await phase('queries', 20000, 10, (index) => request(paths[index % paths.length]));
    // Read-only persistence evidence, not an alternate business ingestion path.
    const counts = await compose('exec', '-T', 'mysql', 'sh', '-c',
      'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u "$MYSQL_USER" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM device_minute_metrics; SELECT COUNT(*) FROM device_hourly_metrics;"');
    const numbers = counts.split(/\s+/).map(Number);
    assert.ok(numbers.length === 2 && numbers.every((value) => Number.isSafeInteger(value) && value > 0), 'history_persistence_missing');
    Object.assign(report.evidence, { minuteRows: numbers[0], hourlyRows: numbers[1], devices: 12, seededSamples: 228 });
    for (const service of services) {
      const { stdout } = await exec('docker', ['inspect', '--format', '{{json .State}}', containers[service]]);
      const state = JSON.parse(stdout);
      assert.ok(state.Running && !state.OOMKilled && state.ExitCode === 0, 'container_unhealthy');
    }
    if (report.phases.some((entry) => services.some((service) => entry.resources[service].cpuNs === null
      || entry.resources[service].sampledMemoryMeanBytes === null))) throw new Error('required_stats_unavailable');
    report.status = report.phases.some((entry) => services.some((service) => entry.resources[service].incomplete.length))
      ? 'partial-resource-evidence' : 'complete';
  } catch (error) {
    const safeCodes = new Set(['readiness_timeout', 'workload_incomplete', 'history_persistence_missing',
      'business_request_failed', 'compose_command_failed', 'container_unhealthy', 'session_cookie_missing', 'required_stats_unavailable']);
    report.failures.push(safeCodes.has(error.message) ? error.message : 'functional_or_measurement_failure');
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
