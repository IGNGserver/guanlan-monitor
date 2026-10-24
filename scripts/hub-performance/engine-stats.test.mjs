import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { counterDelta, normalizeStats, readContainerStats } from './engine-stats.mjs';

const ID = 'a1'.repeat(32);
const fixture = () => ({
  read: '2026-10-24T12:00:00Z',
  cpu_stats: { cpu_usage: { total_usage: 123456789, percpu_usage: [123456789] } },
  memory_stats: { usage: 67108864, limit: 1073741824 },
  blkio_stats: {
    io_service_bytes_recursive: [
      { major: 8, minor: 0, op: 'Read', value: 4096 },
      { major: 8, minor: 0, op: 'Write', value: 8192 },
      { major: 8, minor: 1, op: 'rEaD', value: 1024 },
      { major: 8, minor: 1, op: 'WRITE', value: 2048 },
      { major: 8, minor: 0, op: 'Sync', value: 12288 },
      { major: 8, minor: 0, op: 'Async', value: 3072 },
      { major: 8, minor: 0, op: 'Total', value: 15360 },
      { major: 8, minor: 0, op: 'tOtAl', value: 'ignored' },
    ],
  },
});

test('normalizes Engine shape, sums devices case-insensitively, ignores Total/Sync/Async', () => {
  assert.deepEqual(normalizeStats(fixture()), {
    cpuNs: 123456789, memoryBytes: 67108864, readBytes: 5120, writeBytes: 10240, incomplete: [],
  });
});

test('missing samples and empty/missing/invalid block IO never become zero', () => {
  assert.deepEqual(normalizeStats(undefined), {
    cpuNs: null, memoryBytes: null, readBytes: null, writeBytes: null,
    incomplete: ['cpuNs:missing', 'memoryBytes:missing', 'readBytes:missing', 'writeBytes:missing'],
  });
  for (const [entries, reason] of [[undefined, 'missing'], [null, 'missing'], [[], 'empty'], [{}, 'invalid']]) {
    const raw = fixture();
    raw.blkio_stats.io_service_bytes_recursive = entries;
    const result = normalizeStats(raw);
    assert.equal(result.readBytes, null);
    assert.equal(result.writeBytes, null);
    assert.deepEqual(result.incomplete, [`readBytes:${reason}`, `writeBytes:${reason}`]);
  }
  const raw = fixture();
  delete raw.blkio_stats;
  assert.equal(normalizeStats(raw).readBytes, null);
  raw.blkio_stats = { io_service_bytes_recursive: [{ op: 'Total', value: 0 }] };
  assert.deepEqual(normalizeStats(raw).incomplete, ['readBytes:missing', 'writeBytes:missing']);
});

test('zero and the maximum safe integer are valid, absent directions remain unknown', () => {
  const raw = fixture();
  raw.cpu_stats.cpu_usage.total_usage = 0;
  raw.memory_stats.usage = Number.MAX_SAFE_INTEGER;
  raw.blkio_stats.io_service_bytes_recursive = [{ op: 'Read', value: 0 }, { op: 'Write', value: 0 }];
  assert.deepEqual(normalizeStats(raw), {
    cpuNs: 0, memoryBytes: Number.MAX_SAFE_INTEGER, readBytes: 0, writeBytes: 0, incomplete: [],
  });
  raw.blkio_stats.io_service_bytes_recursive.pop();
  assert.deepEqual(normalizeStats(raw).incomplete, ['writeBytes:missing']);
  assert.equal(normalizeStats(raw).writeBytes, null);
});

test('invalid scalar counters and any invalid contribution invalidate their metric', () => {
  for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1', true, {}, null, undefined]) {
    const raw = fixture();
    raw.cpu_stats.cpu_usage.total_usage = value;
    raw.memory_stats.usage = value;
    raw.blkio_stats.io_service_bytes_recursive.push({ op: 'Read', value });
    const result = normalizeStats(raw);
    assert.equal(result.cpuNs, null);
    assert.equal(result.memoryBytes, null);
    assert.equal(result.readBytes, null);
    assert.equal(result.writeBytes, 10240);
    assert.equal(result.incomplete.length, 3);
  }
  const raw = fixture();
  raw.blkio_stats.io_service_bytes_recursive = [
    { op: 'Read', value: Number.MAX_SAFE_INTEGER }, { op: 'Read', value: 1 },
    { op: 'Write', value: 0 },
  ];
  assert.equal(normalizeStats(raw).readBytes, null);
  assert.deepEqual(normalizeStats(raw).incomplete, ['readBytes:invalid']);
  raw.blkio_stats.io_service_bytes_recursive.push(null);
  assert.deepEqual(normalizeStats(raw).incomplete, ['readBytes:invalid', 'writeBytes:invalid']);
});

test('counter deltas preserve valid zeros and omit memory', () => {
  assert.deepEqual(counterDelta(
    { cpuNs: 10, readBytes: 20, writeBytes: 30, memoryBytes: 100 },
    { cpuNs: 15, readBytes: 20, writeBytes: 40, memoryBytes: 50 },
  ), { cpuNs: 5, readBytes: 0, writeBytes: 10, incomplete: [] });
});

test('counter deltas reject resets and unavailable/invalid values', () => {
  assert.deepEqual(counterDelta(
    { cpuNs: 20, readBytes: null, writeBytes: 30 },
    { cpuNs: 10, readBytes: 50, writeBytes: -1 },
  ), {
    cpuNs: null, readBytes: null, writeBytes: null,
    incomplete: ['cpuNs:decreased', 'readBytes:unavailable', 'writeBytes:unavailable'],
  });
  assert.equal(counterDelta(undefined, {}).incomplete.length, 3);
  for (const metric of ['cpuNs', 'readBytes', 'writeBytes']) {
    const result = counterDelta({ [metric]: 1 }, { [metric]: 0 });
    assert.equal(result[metric], null);
    assert.ok(result.incomplete.includes(`${metric}:decreased`));
  }
  for (const value of [undefined, null, NaN, Infinity, 0.5, -1, '0', Number.MAX_SAFE_INTEGER + 1]) {
    for (const metric of ['cpuNs', 'readBytes', 'writeBytes']) {
      for (const [before, after] of [[value, 0], [0, value]]) {
        const result = counterDelta({ [metric]: before }, { [metric]: after });
        assert.equal(result[metric], null);
        assert.ok(result.incomplete.includes(`${metric}:unavailable`));
      }
    }
  }
});

// All network tests use isolated fake Unix sockets, never a real Docker endpoint.
async function withEngine(handler, run) {
  const directory = await mkdtemp(join(tmpdir(), 'engine-stats-'));
  const socketPath = join(directory, 'engine.sock');
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    await run(socketPath);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

function exactError(message) {
  return (error) => {
    assert.equal(error.message, message);
    assert.equal(error.cause, undefined);
    assert.ok(!error.stack.includes('PRIVATE_ENGINE_SECRET'));
    return true;
  };
}

test('rejects IDs before contacting Engine, including paths and short IDs', async () => {
  await withEngine(() => assert.fail('invalid IDs must not send requests'), async (socketPath) => {
    for (const id of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), '../secret', `${ID}\n`, null, 123, {}]) {
      await assert.rejects(readContainerStats(id, { socketPath }), exactError('Invalid container ID'));
    }
  });
});

test('fetches raw JSON using the daemon API and non-streaming query', async () => {
  const id = ID.toUpperCase();
  await withEngine((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, `/containers/${id}/stats?stream=false&one-shot=true`);
    response.end(JSON.stringify(fixture()));
  }, async (socketPath) => {
    assert.deepEqual(await readContainerStats(id, { socketPath }), fixture());
  });
});

test('HTTP errors are fixed and do not expose response headers or bodies', async () => {
  for (const status of [301, 404, 500]) {
    await withEngine((_request, response) => {
      response.writeHead(status, { 'x-private': 'PRIVATE_ENGINE_SECRET' });
      response.end('PRIVATE_ENGINE_SECRET');
    }, async (socketPath) => {
      await assert.rejects(readContainerStats(ID, { socketPath }), exactError('Engine stats HTTP error'));
    });
  }
});

test('wall-clock deadline handles no response and an actively streaming response', async () => {
  for (const stream of [false, true]) {
    await withEngine((_request, response) => {
      if (!stream) return;
      response.write('{"data":"');
      const interval = setInterval(() => response.write('x'), 5);
      response.once('close', () => clearInterval(interval));
    }, async (socketPath) => {
      await assert.rejects(readContainerStats(ID, { socketPath, timeoutMs: 75 }), exactError('Engine stats request timed out'));
    });
  }
});

test('body limit accepts exactly 4 MiB and rejects oversized chunked bodies', async () => {
  const limit = 4 * 1024 * 1024;
  await withEngine((_request, response) => {
    response.end(`"${'x'.repeat(limit - 2)}"`);
  }, async (socketPath) => {
    assert.equal((await readContainerStats(ID, { socketPath })).length, limit - 2);
  });
  await withEngine((_request, response) => {
    response.write('"');
    for (let i = 0; i < 65; i += 1) response.write('x'.repeat(65536));
    response.end('"');
  }, async (socketPath) => {
    await assert.rejects(readContainerStats(ID, { socketPath }), exactError('Engine stats response too large'));
  });
});

test('malformed JSON and aborted responses yield sanitized failures', async () => {
  await withEngine((_request, response) => response.end('PRIVATE_ENGINE_SECRET'), async (socketPath) => {
    await assert.rejects(readContainerStats(ID, { socketPath }), exactError('Engine stats returned invalid JSON'));
  });
  await withEngine((_request, response) => {
    response.writeHead(200, { 'content-length': '200' });
    response.write('{');
    setImmediate(() => response.destroy());
  }, async (socketPath) => {
    await assert.rejects(readContainerStats(ID, { socketPath }), exactError('Engine stats response failed'));
  });
});

test('socket failures and invalid options never disclose socket paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'engine-stats-'));
  try {
    await assert.rejects(readContainerStats(ID, { socketPath: join(directory, 'PRIVATE_ENGINE_SECRET') }), exactError('Engine stats request failed'));
    for (const timeoutMs of [0, -1, Infinity, NaN, 0.5, 2 ** 31, '5000']) {
      await assert.rejects(readContainerStats(ID, { timeoutMs }), exactError('Invalid Engine stats options'));
    }
    await assert.rejects(readContainerStats(ID, { socketPath: '' }), exactError('Invalid Engine stats options'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
