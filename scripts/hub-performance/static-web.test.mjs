import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { verifyStaticWeb } from './static-web.mjs';

test('static HTTP gate checks real responses and rejects a forwarded-protocol spoof', async () => {
  let insecureProxy = false;
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
    for (const [key, value] of Object.entries({
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin', 'permissions-policy': 'camera=(), geolocation=(), microphone=()',
      'content-security-policy': "default-src 'self'; worker-src 'self'", 'strict-transport-security': 'max-age=31536000'
    })) response.setHeader(key, value);
    const path = request.url;
    if (path === '/' && !request.headers.rsc || path === '/devices/perf-0') response.end('<html>public shell</html>');
    else if (path === '/sw.js') {
      response.setHeader('service-worker-allowed', '/'); response.end('// worker');
    } else if (path === '/manifest.json') {
      response.setHeader('content-type', 'application/manifest+json'); response.end('{}');
    } else if (path === '/pwa-assets.json') response.end('{"assets":["/","/_next/static/app-abcdef0123456789.js"]}');
    else if (path === '/devices/perf-0/?window=5m') {
      response.statusCode = 308; response.setHeader('location', '/devices/perf-0?window=5m'); response.end();
    }
    else if (path === '/_next/static/app-abcdef0123456789.js') {
      response.setHeader('cache-control', 'public, max-age=31536000, immutable');
      response.setHeader('content-type', 'application/javascript'); response.end('// asset');
    } else if (path === '/api/devices') { response.statusCode = 401; response.end('{}'); }
    else if (path === '/api/auth/login') {
      request.resume();
      response.setHeader('set-cookie', `dsc_session=synthetic; HttpOnly${insecureProxy ? '; Secure' : ''}`);
      response.end('{}');
    } else { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await verifyStaticWeb(origin, 'synthetic-test-only')).forwardedProtocol, true);
    insecureProxy = true;
    await assert.rejects(verifyStaticWeb(origin, 'synthetic-test-only'), /spoofed_forwarded_protocol_accepted/);
    await assert.rejects(verifyStaticWeb('https://example.com', 'unused'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
