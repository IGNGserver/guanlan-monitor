import assert from "node:assert/strict";
import test from "node:test";
import { AuthFailureRateLimiter } from "../auth.js";
import { LocalRealtimeRepository, LocalHistoryRepository, LocalDeviceRepository, createLocalStore } from "../repositories/local.js";
import { mapHistoryRow } from "../repositories/history.js";
import { MetricsService } from "./metrics.js";
import type { TimeSeriesRecord } from "../types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMetricsPayload } from "@dsc/shared";

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

test("replayed older samples cannot replace live telemetry or roll back the current series", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsc-test-replay-"));
  try {
    const store = createLocalStore(join(dir, "db.json"));
    const realtime = new LocalRealtimeRepository(store);
    const service = new MetricsService(
      { realtime, history: new LocalHistoryRepository(store), devices: new LocalDeviceRepository(store) },
      () => undefined,
      { get: async () => null, set: async () => undefined }
    );
    const payload: AgentMetricsPayload = {
      identity: { deviceId: "node-1", hostname: "node-1", os: "linux", platform: "linux", arch: "x64" },
      timestamp: new Date(Date.now() - 5_000).toISOString(),
      heartbeatAt: new Date().toISOString(),
      system: { processCount: 1, threadCount: 1, handleCount: 1 },
      cpuUsagePercent: 50,
      memory: { totalBytes: 100, usedBytes: 50, availableBytes: 50, cachedBytes: 0, committedBytes: 0, commitLimitBytes: 0, swapTotalBytes: 0, swapUsedBytes: 0 },
      diskUsage: { totalBytes: 100, usedBytes: 50 },
      diskRate: { readBytesPerSec: 0, writeBytesPerSec: 0 },
      networkRate: { rxBytesPerSec: 0, txBytesPerSec: 0, totalRxBytes: 0, totalTxBytes: 0 },
      gpus: [], fans: []
    };
    await service.ingest(payload);
    await service.ingest({ ...payload, timestamp: new Date(Date.parse(payload.timestamp) - 30_000).toISOString(), cpuUsagePercent: 10 });
    assert.equal((await realtime.getDevice("node-1"))?.latest.cpuUsagePercent, 50);
    assert.equal((await realtime.readSeries("node-1", "1m")).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MySQL history rows recover averaged CPU, network, and fan instances", () => {
  const row = mapHistoryRow({
    timestamp: Date.now(),
    diskInstancesJson: "[]",
    gpuInstancesJson: "[]",
    recordedDetailsJson: JSON.stringify({
      hardwareSampledAt: "2026-09-27T00:00:00.123Z",
      aggregatedInstances: {
        cpus: [{ id: "cpu-0", name: "CPU", temperatureC: 55 }],
        networks: [{ id: "net-0", name: "Network", rxBytesPerSec: 100 }],
        fans: [{ id: "fan-0", name: "Fan", rpm: 500 }]
      }
    })
  });
  assert.equal(row.cpus?.[0]?.temperatureC, 55);
  assert.equal(row.networks?.[0]?.rxBytesPerSec, 100);
  assert.equal(row.fans?.[0]?.rpm, 500);
  assert.equal(row.hardwareSampledAt, "2026-09-27T00:00:00.123Z");
});
