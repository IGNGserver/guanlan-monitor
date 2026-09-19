import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DesktopCacheStore } from '../apps/desktop/dist/main/cache-store.js';
import { createRemoteSessionProbe } from '../apps/desktop/dist/main/runtime-profile.js';
import { startVisiblePolling } from '../packages/console-ui/src/helpers/visiblePolling.ts';

mock.module('electron', { namedExports: {
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir(), getVersion: () => '3.0.28' },
  shell: {}
} });
const { HubClient } = await import('../apps/desktop/dist/main/hub-client.js');
const { DesktopController } = await import('../apps/desktop/dist/main/controller.js');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const snapshot = (n) => ({ generatedAt: String(n), devices: [{ deviceId: 'a' }], session: {
  authenticated: true, accessKeyConfigured: true, secret: 'must-not-persist'
} });

test('cache loads once, coalesces 12 refreshes, preserves latest offline data and flushes on exit', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsc-cache-test-'));
  try {
    const file = path.join(dir, 'desktop-cache.json');
    const cache = new DesktopCacheStore(dir);
    assert.equal(await cache.read(), null);
    await cache.write(snapshot(0));
    const first = await readFile(file, 'utf8');
    for (let i = 1; i <= 12; i++) await cache.write(snapshot(i));
    assert.equal(await readFile(file, 'utf8'), first, 'refreshes within a minute must not rewrite disk');
    assert.equal((await cache.read()).generatedAt, '12');
    assert.equal((await cache.read()).session.secret, undefined);
    await cache.flush();
    assert.equal(JSON.parse(await readFile(file, 'utf8')).snapshot.generatedAt, '12');
    await writeFile(file, 'invalid JSON');
    assert.equal((await cache.read()).generatedAt, '12', 'hot reads must not reparse disk');
    const corrupt = new DesktopCacheStore(dir);
    assert.equal(await corrupt.read(), null);
    await corrupt.write(snapshot(13));
    assert.equal((await new DesktopCacheStore(dir).read()).generatedAt, '13');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cache retries a failed write and preserves the newest snapshot', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsc-cache-retry-'));
  const blocker = path.join(dir, 'not-a-directory');
  try {
    await writeFile(blocker, 'x');
    const cache = new DesktopCacheStore(blocker);
    await assert.rejects(cache.write(snapshot(1)));
    await rm(blocker);
    await cache.write(snapshot(2));
    assert.equal((await new DesktopCacheStore(blocker).read()).generatedAt, '2');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('RDP probe never blocks, shares in-flight work, expires and survives failure', async () => {
  let now = 0, calls = 0, release;
  const read = createRemoteSessionProbe(() => { calls++; return new Promise((resolve) => { release = resolve; }); }, () => now);
  for (let i = 0; i < 100; i++) assert.equal(read(), false);
  await settle();
  assert.equal(calls, 1);
  release(false);
  await settle();
  assert.equal(read(), false);
  now = 30_001;
  assert.equal(read(), false);
  await settle();
  assert.equal(calls, 2);
  release(true);
  await settle();
  assert.equal(read(), true);
  const failed = createRemoteSessionProbe(() => Promise.reject(new Error('missing query.exe')));
  assert.equal(failed(), false);
  await settle();
  assert.equal(failed(), false);
});

test('hidden polling stops, resumes once, avoids overlap and cleans up on disposal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const visibility = new EventTarget();
  visibility.hidden = true;
  let calls = 0, release;
  const stop = startVisiblePolling(() => { calls++; return new Promise((resolve) => { release = resolve; }); }, 5000, true, visibility);
  t.mock.timers.tick(60_000);
  assert.equal(calls, 0);
  visibility.hidden = false;
  visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  visibility.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
  release(); await settle();
  t.mock.timers.tick(5000);
  assert.equal(calls, 2);
  visibility.hidden = true;
  visibility.dispatchEvent(new Event('visibilitychange'));
  release(); await settle();
  t.mock.timers.tick(60_000);
  assert.equal(calls, 2);
  stop();
  visibility.hidden = false;
  visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 2);
});

test('update metadata is cached per Hub/version and failures remain retryable', async () => {
  const client = new HubClient('/unused');
  let calls = 0;
  client.request = async () => ({ available: true, requestNumber: ++calls });
  client.setServerUrl('http://localhost:3100');
  for (let i = 0; i < 180; i++) assert.equal((await client.getUpdateInfo('3.0.28')).requestNumber, 1);
  await client.getUpdateInfo('3.0.29');
  assert.equal(calls, 2);
  client.setServerUrl('http://localhost:3200');
  await client.getUpdateInfo('3.0.29');
  assert.equal(calls, 3);
  client.request = async () => { throw Error('offline'); };
  await assert.rejects(client.getUpdateInfo('3.0.30'));
  client.request = async () => ({ available: false });
  assert.equal((await client.getUpdateInfo('3.0.30')).available, false);
});

test('desktop optional endpoints run concurrently without dropping successful data', async () => {
  const controller = new DesktopController();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const called = [];
  controller.hub.accessKey = 'fixture';
  controller.hub.listDevices = async () => [{ deviceId: 'a' }];
  for (const name of ['getMetrics', 'getOverviewMetrics', 'getUpdateInfo']) {
    controller.hub[name] = async () => { called.push(name); await gate; if (name === 'getMetrics') throw Error('offline'); return { endpoint: name }; };
  }
  controller.readTrafficCalendar = async () => { called.push('calendar'); await gate; return null; };
  const pending = controller.readLiveData({ config: { connection: { secret: "" } } });
  await settle();
  assert.equal(called.length, 4);
  release();
  const result = await pending;
  assert.equal(result.metrics, null);
  assert.equal(result.overviewMetrics.endpoint, 'getOverviewMetrics');
  assert.equal(result.authenticated, true);
});

test('parallel session requests perform one authentication', async () => {
  const client = new HubClient('/unused');
  client.setServerUrl('http://localhost:3100');
  client.accessKey = 'fixture';
  let calls = 0, release;
  client.login = async () => { calls++; await new Promise((resolve) => { release = resolve; }); client.sessionCookie = 'dsc_session=fixture'; };
  const pending = Array.from({ length: 10 }, () => client.ensureSession());
  assert.equal(calls, 1);
  release(); await Promise.all(pending);
});

test('packaged main and preload have no external npm runtime imports', async () => {
  const { readdir } = await import('node:fs/promises');
  const { builtinModules } = await import('node:module');
  const inspect = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await inspect(file); continue; }
      if (!file.endsWith('.js')) continue;
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g)) {
        const specifier = match[1];
        assert.ok(specifier === 'electron' || specifier.startsWith('node:') || builtinModules.includes(specifier) || specifier.startsWith('.'), `${file} needs unpackaged dependency ${specifier}`);
      }
    }
  };
  await inspect('apps/desktop/dist/main');
  await inspect('apps/desktop/dist/preload');
});
