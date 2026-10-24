import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export const metricKeys = ["cpuUsagePercent", "memoryUsagePercent", "diskUsagePercent", "networkRxBytesPerSec", "networkTxBytesPerSec"];

export function validateNumbers(value) {
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("prototype only supports finite numbers in the safe-number range");
  }
  if (value && typeof value === "object") for (const item of Object.values(value)) validateNumbers(item);
}

// Type-tagged, length-prefixed UTF-8 tree encoding. Numbers are IEEE754 bits,
// not language-specific decimal spellings; -0 is normalized after JSON encode.
// This is a research equality digest, NOT RFC 8785 or a wire protocol.
export function canonicalSha256(value) {
  const hash = createHash("sha256");
  const emit = (item) => {
    if (item === null) return void hash.update("n");
    if (typeof item === "boolean") return void hash.update(item ? "t" : "f");
    if (typeof item === "number") {
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleBE(item === 0 ? 0 : item);
      return void hash.update(`d${bytes.toString("hex")}`);
    }
    if (typeof item === "string") {
      const bytes = Buffer.from(item);
      hash.update(`s${bytes.length}:`);
      return void hash.update(bytes);
    }
    if (Array.isArray(item)) {
      hash.update(`a${item.length}:`);
      for (const child of item) emit(child);
      return;
    }
    const keys = Object.keys(item).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    hash.update(`o${keys.length}:`);
    for (const key of keys) { emit(key); emit(item[key]); }
  };
  emit(value);
  return hash.digest("hex");
}

export function transform(raw) {
  const batch = JSON.parse(raw);
  if (!Array.isArray(batch)) throw new TypeError("batch must be an array");
  validateNumbers(batch);
  const devices = new Map();
  for (const payload of batch) {
    const device = payload?.identity?.deviceId;
    const timestamp = payload?.timestamp;
    if (typeof device !== "string" || !device || typeof timestamp !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
        !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new TypeError("invalid identity/timestamp");
    const points = devices.get(device) ?? new Map();
    points.set(timestamp, payload); // Last writer wins, independent of arrival order.
    devices.set(device, points);
  }
  const records = [];
  const summary = [];
  const byteSort = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  for (const deviceId of [...devices.keys()].sort(byteSort)) {
    const points = devices.get(deviceId);
    const sums = Object.fromEntries(metricKeys.map((key) => [key, 0]));
    for (const timestamp of [...points.keys()].sort()) {
      const payload = points.get(timestamp);
      const ratio = (object) => {
        if (!object || typeof object.totalBytes !== "number" || typeof object.usedBytes !== "number") throw new TypeError("invalid capacity");
        return object.totalBytes > 0 ? object.usedBytes / object.totalBytes * 100 : 0;
      };
      const values = [payload.cpuUsagePercent, ratio(payload.memory), ratio(payload.diskUsage), payload.networkRate?.rxBytesPerSec, payload.networkRate?.txBytesPerSec];
      values.forEach((value, index) => {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("invalid summary metric");
        sums[metricKeys[index]] += value;
      });
      records.push(payload); // Unknown fields survive: no typed projection of raw input.
    }
    summary.push({ deviceId, sampleCount: points.size, metrics: Object.fromEntries(metricKeys.map((key) => [key, sums[key] / points.size])) });
  }
  return Buffer.from(JSON.stringify({ records, summary }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, iterationsText = "0"] = process.argv.slice(2);
  const iterations = Number(iterationsText);
  if (!input || !Number.isSafeInteger(iterations) || iterations < 0) throw new Error("usage: node language.mjs INPUT [ITERATIONS=0]");
  const raw = readFileSync(input); // Decode UTF-8 inside JSON.parse, not before the timed loop.
  if (iterations === 0) {
    const result = JSON.parse(transform(raw));
    console.log(JSON.stringify({ result, canonicalSha256: canonicalSha256(result) }));
  } else {
    for (let i = 0; i < 3; i++) transform(raw);
    const cpu = process.cpuUsage();
    const wall = performance.now();
    const latencies = [];
    let encoded;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      encoded = transform(raw);
      latencies.push(performance.now() - start);
    }
    const wallMs = performance.now() - wall;
    const used = process.cpuUsage(cpu);
    const peakRssBytes = process.resourceUsage().maxRSS * 1024;
    latencies.sort((a, b) => a - b);
    console.log(JSON.stringify({ canonicalSha256: canonicalSha256(JSON.parse(encoded)), measurements: {
      iterations, inputBytes: Buffer.byteLength(raw), outputBytes: Buffer.byteLength(encoded), wallMs,
      cpuUserMs: used.user / 1000, cpuSystemMs: used.system / 1000,
      peakRssBytes,
      p50BatchMs: latencies[Math.ceil(iterations * 0.5) - 1], p95BatchMs: latencies[Math.ceil(iterations * 0.95) - 1]
    } }));
  }
}
