import assert from 'node:assert/strict';
import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

export async function nativeUpgrade(origin, accessKey, onStage = () => {}) {
  const target = new URL(origin);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.protocol, 'http:');
  const deviceId = `perf-live-${randomUUID()}`, instanceId = randomUUID(), token = randomBytes(32).toString('hex');
  onStage('native-enroll');
  const enrolled = await fetch(`${origin}/api/agent/enroll`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessKey}` },
    body: JSON.stringify({ deviceId, instanceId, token })
  });
  assert.equal(enrolled.status, 200, 'native_fixture_enrollment_failed');
  // Agent authentication uses headers, which the browser WebSocket constructor
  // cannot supply. Exercise the actual HTTP Upgrade at the same public origin.
  for (const authorized of [false, true]) await new Promise((resolve, reject) => {
    onStage(authorized ? 'native-upgrade-authorized' : 'native-upgrade-unauthorized');
    const key = randomBytes(16).toString('base64');
    const request = httpRequest(`${origin}/api/agent/realtime`, {
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': key, 'sec-websocket-version': '13',
        ...(authorized ? { authorization: `Bearer ${token}`, 'x-device-id': deviceId, 'x-instance-id': instanceId } : {}) }
    });
    const timeout = setTimeout(() => request.destroy(new Error('native_upgrade_timeout')), 5000);
    const finish = (error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
    request.once('error', () => finish(new Error('native_upgrade_failed')));
    request.once('response', (response) => {
      response.resume();
      finish(!authorized && response.statusCode === 401 ? null
        : Object.assign(new Error('native_upgrade_auth_boundary_failed'), { statusCode: response.statusCode }));
    });
    request.once('upgrade', (response, socket) => {
      const expected = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.destroy();
      finish(authorized && response.statusCode === 101 && response.headers['sec-websocket-accept'] === expected
        ? null : new Error('native_upgrade_protocol_failed'));
    });
    request.end();
  });
}

export function validateBrowserTarget(origin, modulePath, environment = process.env) {
  const target = new URL(origin);
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'browser_ci_only');
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(Number(target.port) >= 1024, 'random_loopback_port_required');
  assert.equal(target.pathname, '/');
  assert.ok(!target.username && !target.password && !target.search && !target.hash);
  assert.ok(isAbsolute(modulePath) && environment.RUNNER_TEMP && isAbsolute(environment.RUNNER_TEMP));
  const local = relative(environment.RUNNER_TEMP, modulePath);
  assert.ok(local && local !== '..' && !local.startsWith('../') && !isAbsolute(local), 'runner_local_browser_required');
  return target.origin;
}

/** Browser parity against the actual isolated image, never a mocked API server. */
export async function browserSmoke({ origin, accessKey, modulePath, pauseOrigin, resumeOrigin, onStage = () => {} }) {
  validateBrowserTarget(origin, modulePath);
  const { chromium, webkit } = await import(pathToFileURL(modulePath).href);
  await nativeUpgrade(origin, accessKey, onStage);
  const results = {};
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    onStage(`${name}-launch`);
    const browser = await engine.launch({ headless: true });
    let originPaused = false;
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      let socketAccepted = false;
      page.on('websocket', (socket) => {
        if (!new URL(socket.url()).pathname.startsWith('/socket.io/')) return;
        socket.on('framereceived', ({ payload }) => {
          if (String(payload).startsWith('40')) socketAccepted = true;
        });
      });
      onStage(`${name}-login`);
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#access-key').fill(accessKey);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.locator('.workspace-page--overview').waitFor({ timeout: 30000 });
      onStage(`${name}-worker-install`);
      await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30000 });
      // Wait for the actual authenticated Socket.IO upgrade, not just a 101.
      onStage(`${name}-socket-io`);
      const socketDeadline = Date.now() + 10000;
      while (!socketAccepted && Date.now() < socketDeadline) await page.waitForTimeout(50);
      assert.ok(socketAccepted, 'socket_io_handshake_missing');
      onStage(`${name}-deep-link`);
      await page.goto(`${origin}/devices/perf-0`, { waitUntil: 'domcontentloaded' });
      await page.locator('.workspace-page--device').waitFor({ timeout: 30000 });
      assert.ok(!page.url().includes('__shell'), 'deep_link_rewritten');
      // The public shell must boot with its declared chunks and session-scoped
      // telemetry when neither the proxy nor the API can be reached.
      // WebKit's automation offline flag also blocks worker-only navigation
      // (Playwright #42775). Use an actual isolated-origin outage there.
      onStage(`${name}-offline`);
      if (name === 'webkit') { await pauseOrigin(); originPaused = true; }
      else await context.setOffline(true);
      const offlineDocument = await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(offlineDocument.fromServiceWorker(), true, 'offline_document_not_from_worker');
      onStage(`${name}-offline-device`);
      await page.locator('.workspace-page--device').waitFor({ timeout: 30000 });
      onStage(`${name}-offline-cache-indicator`);
      // This is a desktop viewport; the dotted notice exists only in the touch
      // layout. Assert the actual desktop detail banner, not a phone selector.
      await page.getByText('当前显示离线缓存', { exact: true }).first().waitFor({ timeout: 30000 });
      onStage(`${name}-cache-boundary`);
      const cachedPaths = await page.evaluate(async () => {
        const paths = [];
        for (const key of await caches.keys()) if (key.startsWith('guanlan-shell-')) {
          const cache = await caches.open(key);
          paths.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
        }
        return paths;
      });
      assert.ok(!cachedPaths.some((path) => path.startsWith('/api/') || path.startsWith('/socket.io')), 'private_response_cached');
      results[name] = { login: true, socketIo: true, nativeWebSocketAuth: true, deepLink: true, offline: true };
      await context.close();
    } finally {
      await browser.close();
      if (originPaused) await resumeOrigin();
    }
  }
  return results;
}
