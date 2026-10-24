import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBrowserTarget, nativeUpgrade } from './browser-smoke.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

test('image browser tests cannot target production or load modules outside runner scratch', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/runner/tmp' };
  const modulePath = '/runner/tmp/browser/node_modules/playwright/index.mjs';
  assert.equal(validateBrowserTarget('http://127.0.0.1:32768', modulePath, env), 'http://127.0.0.1:32768');
  for (const origin of ['http://192.168.5.17:3000', 'https://127.0.0.1:32768', 'http://127.0.0.1:80',
    'http://127.0.0.1:32768/path', 'http://user:secret@127.0.0.1:32768', 'http://127.0.0.1:32768/?x=1']) {
    assert.throws(() => validateBrowserTarget(origin, modulePath, env));
  }
  for (const path of ['/runner/other/index.mjs', '/runner/tmp/../escape.mjs', 'relative.mjs']) {
    assert.throws(() => validateBrowserTarget('http://127.0.0.1:32768', path, env));
  }
  assert.throws(() => validateBrowserTarget('http://127.0.0.1:32768', modulePath, {}));
});

test('native agent parity expects pre-upgrade HTTP 401 and a separately authenticated 101', async () => {
  let enrollment, rejected = 0, upgraded = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/api/agent/enroll');
    assert.equal(request.headers.authorization, 'Bearer synthetic-test-only');
    let body = '';
    for await (const chunk of request) body += chunk;
    enrollment = JSON.parse(body);
    response.end('{"ok":true}');
  });
  server.on('upgrade', (request, socket) => {
    assert.equal(request.url, '/api/agent/realtime');
    if (!request.headers.authorization) {
      rejected++;
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${enrollment.token}`);
    assert.equal(request.headers['x-device-id'], enrollment.deviceId);
    assert.equal(request.headers['x-instance-id'], enrollment.instanceId);
    upgraded++;
    const accept = createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await nativeUpgrade(`http://127.0.0.1:${server.address().port}`, 'synthetic-test-only');
    assert.equal(rejected, 1);
    assert.equal(upgraded, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
