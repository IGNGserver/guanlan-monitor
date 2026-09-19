import assert from "node:assert/strict";
import test from "node:test";
import { AuthFailureRateLimiter } from "../auth.js";
import { LocalRealtimeRepository, LocalHistoryRepository, createLocalStore } from "../repositories/local.js";
import { MetricsService } from "./metrics.js";
import type { TimeSeriesRecord } from "../types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("auth failure rate limiter records failures and rejects after threshold", () => {
  const limiter = new AuthFailureRateLimiter();
  const ip = "192.168.1.100";
  assert.equal(limiter.allow(ip), true);
  for (let i = 0; i < 5; i++) {
    limiter.recordFailure(ip);
  }
  assert.equal(limiter.allow(ip), false);
  limiter.clear(ip);
  assert.equal(limiter.allow(ip), true);
});

test("history repository merges higher sample count points and protects against partial aggregate overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsc-test-history-"));
  try {
    const store = createLocalStore(join(dir, "db.json"));
    const historyRepo = new LocalHistoryRepository(store);
    const timestamp = Date.now() - 60000; // 1 minute ago

    const fullAggregate: TimeSeriesRecord = {
      timestamp,
      cpuUsagePercent: 50,
      cpuFrequencyMHz: 3000,
      cpuTemperatureC: 45,
      gpuUsagePercent: 0,
      gpuEncodePercent: 0,
      gpuDecodePercent: 0,
      gpuFrequencyMHz: 0,
      gpuMemoryUsagePercent: 0,
      gpuTemperatureC: 0,
      memoryUsagePercent: 60,
      swapUsagePercent: 0,
      memoryUsedBytes: 8000,
      swapUsedBytes: 0,
      diskUsagePercent: 40,
      diskUsedBytes: 5000,
      diskReadBytesPerSec: 100,
      diskWriteBytesPerSec: 200,
      networkRxBytesPerSec: 300,
      networkTxBytesPerSec: 400,
      trafficRxBytes: 1000,
      trafficTxBytes: 2000,
      sampleCount: 12
    };

    await historyRepo.insertMinutePoint("dev-1", fullAggregate);

    // Stale or single late sample with sampleCount: 1 arrives later for the same bucket
    const latePartial: TimeSeriesRecord = {
      ...fullAggregate,
      cpuUsagePercent: 10,
      sampleCount: 1
    };

    await historyRepo.insertMinutePoint("dev-1", latePartial);

    const series = await historyRepo.getHistoricalSeries("dev-1", "1d");
    assert.equal(series.length, 1);
    // Should retain the full aggregate of 50%, not overwritten by 10%
    assert.equal(series[0].cpuUsagePercent, 50);
    assert.equal(series[0].sampleCount, 12);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
