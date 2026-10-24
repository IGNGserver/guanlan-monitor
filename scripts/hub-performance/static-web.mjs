import assert from 'node:assert/strict';

/** HTTP contracts against the actual exported nginx image, not source regexes. */
export async function verifyStaticWeb(origin, accessKey) {
  const target = new URL(origin);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(Number(target.port) >= 1024 && !target.username && !target.password);
  const request = (path, init = {}) => fetch(`${origin}${path}`, { ...init,
    redirect: 'manual', signal: AbortSignal.timeout(5000) });
  const root = await request('/');
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.match(html, /<html/i);
  for (const [name, expected] of Object.entries({
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()'
  })) assert.equal(root.headers.get(name), expected);
  assert.match(root.headers.get('content-security-policy') ?? '', /worker-src 'self'/);
  assert.doesNotMatch(root.headers.get('content-security-policy') ?? '', /unsafe-eval/);
  assert.match(root.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  for (const path of ['/sw.js', '/pwa-assets.json', '/manifest.json']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    if (path === '/sw.js') assert.equal(response.headers.get('service-worker-allowed'), '/');
    if (path === '/manifest.json') assert.match(response.headers.get('content-type') ?? '', /application\/manifest\+json/);
    await response.arrayBuffer();
  }
  const manifest = await (await request('/pwa-assets.json')).json();
  const asset = [...manifest.assets, ...(manifest.runtimeAssets ?? [])]
    .find((path) => /\.[a-f0-9]{8,}\.js$|[-/][a-f0-9]{8,}[^/]*\.js$/.test(path));
  assert.ok(asset, 'hashed_asset_missing');
  const hashed = await request(asset);
  assert.equal(hashed.status, 200);
  assert.match(hashed.headers.get('content-type') ?? '', /javascript/);
  assert.match(hashed.headers.get('cache-control') ?? '', /immutable/);
  await hashed.arrayBuffer();
  for (const path of ['/not-a-public-route', '/.env', '/_next/static/not-real-abcdef0123456789.js', '/index.txt', '/source.map', '/?_rsc=fixture']) {
    const response = await request(path);
    assert.equal(response.status, 404, 'private_or_unknown_route_exposed');
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/);
    await response.arrayBuffer();
  }
  const rsc = await request('/', { headers: { RSC: '1' } });
  assert.equal(rsc.status, 404);
  await rsc.arrayBuffer();
  const denied = await request('/api/devices');
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('cache-control') ?? '', /no-store/);
  await denied.arrayBuffer();
  const deep = await request('/devices/perf-0');
  assert.equal(deep.status, 200);
  assert.equal(await deep.text(), html, 'deep_link_not_public_shell');
  const trailing = await request('/devices/perf-0/?window=5m');
  assert.ok([301, 308].includes(trailing.status), 'deep_link_trailing_slash_not_canonical');
  const canonical = new URL(trailing.headers.get('location'), origin);
  assert.equal(canonical.pathname, '/devices/perf-0');
  assert.equal(canonical.search, '?window=5m');
  await trailing.arrayBuffer();
  const spoof = await request('/api/auth/login', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', forwarded: 'proto=https' },
    body: JSON.stringify({ accessKey }) });
  assert.equal(spoof.status, 200);
  const cookie = spoof.headers.getSetCookie().find((value) => value.startsWith('dsc_session='));
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly/i);
  assert.doesNotMatch(cookie, /;\s*Secure/i, 'spoofed_forwarded_protocol_accepted');
  await spoof.arrayBuffer();
  return { securityHeaders: true, immutableAssets: true, workerPolicy: true,
    privateRoutes: true, apiAuth: true, deepLinkShell: true, forwardedProtocol: true };
}
