import assert from "node:assert/strict";
import test from "node:test";
import type { HistoryRepository, TimeSeriesRecord } from "../types.js";
import { CachedHistoryRepository } from "./cached-history.js";

function record(cpuUsagePercent = 10): TimeSeriesRecord {
  return {
    timestamp: 1_700_000_000_000,
    cpuUsagePercent,
    cpuFrequencyMHz: 0,
    cpuTemperatureC: 0,
    gpuUsagePercent: 0,
    gpuEncodePercent: 0,
    gpuDecodePercent: 0,
    gpuFrequencyMHz: 0,
    gpuMemoryUsagePercent: 0,
    gpuTemperatureC: 0,
    memoryUsagePercent: 0,
    swapUsagePercent: 0,
    memoryUsedBytes: 0,
    swapUsedBytes: 0,
    diskUsagePercent: 0,
    diskUsedBytes: 0,
    diskReadBytesPerSec: 0,
    diskWriteBytesPerSec: 0,
    networkRxBytesPerSec: 0,
    networkTxBytesPerSec: 0,
    trafficRxBytes: 100,
    trafficTxBytes: 200
  };
}

function inner() {
  let reads = 0;
  const repo: HistoryRepository = {
    async insertMinutePoint() {},
    async insertHourlyPoint() {},
    async getHistoricalSeries() { reads++; return [record()]; },
    async getTrafficSeries() { reads++; return [{ timestamp: 1, trafficRxBytes: 1, trafficTxBytes: 2 }]; },
    async clearDeviceHistory() {},
    async getTrafficCalendar() { reads++; return { mode: "day", anchor: "", title: "", rangeStart: "", rangeEnd: "", cells: [], records: [], totalRxBytes: 0, totalTxBytes: 0 }; },
    async listKnownDevices() { return []; }
  };
  return { repo, reads: () => reads };
}

test("history reads are cached and writes invalidate only that device", async () => {
  const { repo, reads } = inner();
  const cached = new CachedHistoryRepository(repo, {
    ttlMs: 60_000, calendarTtlMs: 60_000, maxEntries: 32, maxBytes: 1024 * 1024
  });
  const first = await cached.getHistoricalSeries("node-a", "1d");
  const second = await cached.getHistoricalSeries("node-a", "1d");
  assert.equal(reads(), 1);
  assert.notEqual(first, second);
  first[0].cpuUsagePercent = 99;
  assert.equal((await cached.getHistoricalSeries("node-a", "1d"))[0].cpuUsagePercent, 10);
  await cached.insertMinutePoint("node-a", record());
  await cached.getHistoricalSeries("node-a", "1d");
  assert.equal(reads(), 2);
  await cached.getHistoricalSeries("node-b", "1d");
  assert.equal(reads(), 3);
});

test("calendar cache uses local-day keys and bypasses caching when TTL is zero", async () => {
  const { repo, reads } = inner();
  const cached = new CachedHistoryRepository(repo, {
    ttlMs: 0, calendarTtlMs: 60_000, maxEntries: 32, maxBytes: 1024 * 1024
  });
  await cached.getTrafficCalendar("node-a", "day", "2026-10-01T01:00:00.000Z");
  await cached.getTrafficCalendar("node-a", "day", "2026-10-01T05:00:00.000Z");
  assert.equal(reads(), 1);
  await cached.getHistoricalSeries("node-a", "1d");
  await cached.getHistoricalSeries("node-a", "1d");
  assert.equal(reads(), 3);
});

test("shared cache is used as an L2 and failures fall back to MySQL", async () => {
  const { repo, reads } = inner();
  const values = new Map<string, string>();
  let fail = false;
  const shared = {
    async get(key: string) { if (fail) throw new Error("redis down"); return values.get(key) ?? null; },
    async set(key: string, value: string) { values.set(key, value); }
  };
  const first = new CachedHistoryRepository(repo, {
    ttlMs: 60_000, calendarTtlMs: 60_000, maxEntries: 32, maxBytes: 1024 * 1024, shared
  });
  await first.getHistoricalSeries("node-a", "1d");
  const second = new CachedHistoryRepository(repo, {
    ttlMs: 60_000, calendarTtlMs: 60_000, maxEntries: 32, maxBytes: 1024 * 1024, shared
  });
  await second.getHistoricalSeries("node-a", "1d");
  assert.equal(reads(), 1);
  fail = true;
  await second.getHistoricalSeries("node-a", "7d");
  assert.equal(reads(), 2);
});
