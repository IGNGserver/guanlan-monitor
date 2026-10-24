import http from 'node:http';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const COUNTERS = ['cpuNs', 'readBytes', 'writeBytes'];

function isCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function scalar(value, metric, incomplete) {
  if (isCounter(value)) return value;
  incomplete.push(`${metric}:${value == null ? 'missing' : 'invalid'}`);
  return null;
}

function blockIo(entries, incomplete) {
  const metrics = { readBytes: null, writeBytes: null };
  if (!Array.isArray(entries) || entries.length === 0) {
    const reason = entries == null ? 'missing' : Array.isArray(entries) ? 'empty' : 'invalid';
    for (const metric of Object.keys(metrics)) incomplete.push(`${metric}:${reason}`);
    return metrics;
  }

  const totals = { readBytes: 0, writeBytes: 0 };
  const seen = new Set();
  const invalid = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.op !== 'string') {
      invalid.add('readBytes');
      invalid.add('writeBytes');
      continue;
    }
    const op = entry.op.toLowerCase();
    // Total, Sync and Async overlap Read/Write and must not be counted.
    const metric = op === 'read' ? 'readBytes' : op === 'write' ? 'writeBytes' : null;
    if (!metric) continue;
    seen.add(metric);
    if (!isCounter(entry.value) || !isCounter(totals[metric] + entry.value)) {
      invalid.add(metric);
    } else {
      totals[metric] += entry.value;
    }
  }
  for (const metric of Object.keys(metrics)) {
    if (invalid.has(metric)) incomplete.push(`${metric}:invalid`);
    else if (!seen.has(metric)) incomplete.push(`${metric}:missing`);
    else metrics[metric] = totals[metric];
  }
  return metrics;
}

/** Normalize one Engine sample; unavailable counters are never invented as zero. */
export function normalizeStats(raw) {
  const incomplete = [];
  const cpuNs = scalar(raw?.cpu_stats?.cpu_usage?.total_usage, 'cpuNs', incomplete);
  const memoryBytes = scalar(raw?.memory_stats?.usage, 'memoryBytes', incomplete);
  const io = blockIo(raw?.blkio_stats?.io_service_bytes_recursive, incomplete);
  return { cpuNs, memoryBytes, ...io, incomplete };
}

/** Difference normalized cumulative counters, not the instantaneous memory gauge. */
export function counterDelta(before, after) {
  const result = { cpuNs: null, readBytes: null, writeBytes: null, incomplete: [] };
  for (const metric of COUNTERS) {
    const start = before?.[metric];
    const end = after?.[metric];
    if (!isCounter(start) || !isCounter(end)) result.incomplete.push(`${metric}:unavailable`);
    else if (end < start) result.incomplete.push(`${metric}:decreased`);
    else result[metric] = end - start;
  }
  return result;
}

/** Fetch raw Engine JSON. Errors intentionally omit response data and socket details. */
export async function readContainerStats(
  id,
  { socketPath = '/var/run/docker.sock', timeoutMs = 5000 } = {},
) {
  if (typeof id !== 'string' || !/^[a-fA-F0-9]{64}$/.test(id)) {
    throw new Error('Invalid container ID');
  }
  if (typeof socketPath !== 'string' || socketPath.length === 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) {
    throw new Error('Invalid Engine stats options');
  }

  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
      response?.destroy();
      request?.destroy();
    };
    // A wall-clock deadline also bounds slow streaming bodies, not just idle sockets.
    const timer = setTimeout(() => fail('Engine stats request timed out'), timeoutMs);
    try {
      request = http.request({
        socketPath,
        method: 'GET',
        // An unversioned request uses the daemon's supported API. Hard-coding
        // an old API breaks on newer Engines with a higher minimum version.
        path: `/containers/${id}/stats?stream=false&one-shot=true`,
        agent: false,
      }, (incoming) => {
        response = incoming;
        incoming.on('error', () => fail('Engine stats response failed'));
        incoming.on('aborted', () => fail('Engine stats response failed'));
        if (incoming.statusCode !== 200) {
          fail('Engine stats HTTP error');
          return;
        }
        let size = 0;
        const chunks = [];
        incoming.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            fail('Engine stats response too large');
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          if (settled) return;
          let raw;
          try {
            raw = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
          } catch {
            fail('Engine stats returned invalid JSON');
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(raw);
        });
      });
      request.on('error', () => fail('Engine stats request failed'));
      request.end();
    } catch {
      fail('Engine stats request failed');
    }
  });
}
