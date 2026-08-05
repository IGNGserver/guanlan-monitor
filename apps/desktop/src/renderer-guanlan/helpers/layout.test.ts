import assert from "node:assert";
import test from "node:test";
import { getLayoutClass } from "./layout.ts";
import { resolveInteractionScale, detectDefaultInteractionScale } from "./density.ts";
import { resolveEffectiveTheme } from "./theme.ts";
import { normalizeMetricsResponse, formatBytes } from "./metricsNormalizer.ts";
import type { MetricsResponse } from "@dsc/shared";

test("getLayoutClass correctly categorizes window widths at key breakpoints", () => {
  assert.strictEqual(getLayoutClass(390), "compact");
  assert.strictEqual(getLayoutClass(599), "compact");
  assert.strictEqual(getLayoutClass(600), "medium");
  assert.strictEqual(getLayoutClass(800), "medium");
  assert.strictEqual(getLayoutClass(839), "medium");
  assert.strictEqual(getLayoutClass(840), "expanded");
  assert.strictEqual(getLayoutClass(1080), "expanded");
  assert.strictEqual(getLayoutClass(1199), "expanded");
  assert.strictEqual(getLayoutClass(1200), "large");
  assert.strictEqual(getLayoutClass(1440), "large");
  assert.strictEqual(getLayoutClass(1920), "large");
});

test("density helpers resolve correctly and respect overrides", () => {
  assert.strictEqual(detectDefaultInteractionScale(true), "touch");
  assert.strictEqual(detectDefaultInteractionScale(false), "comfortable");

  assert.strictEqual(resolveInteractionScale("compact", true), "compact");
  assert.strictEqual(resolveInteractionScale("comfortable", true), "comfortable");
  assert.strictEqual(resolveInteractionScale("touch", false), "touch");
  assert.strictEqual(resolveInteractionScale("auto", true), "touch");
  assert.strictEqual(resolveInteractionScale("auto", false), "comfortable");
});

test("theme helpers correctly resolve system theme preferences", () => {
  assert.strictEqual(resolveEffectiveTheme("light", true), "light");
  assert.strictEqual(resolveEffectiveTheme("dark", false), "dark");
  assert.strictEqual(resolveEffectiveTheme("system", true), "dark");
  assert.strictEqual(resolveEffectiveTheme("system", false), "light");
});

test("normalizeMetricsResponse extracts stable chart model from MetricsResponse series", () => {
  assert.deepStrictEqual(normalizeMetricsResponse(null), []);

  const sampleMetrics: Partial<MetricsResponse> = {
    series: {
      cpuUsagePercent: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 25.4 }],
      memoryUsagePercent: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 50.1 }],
      gpuUsagePercent: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 10.0 }],
      diskUsagePercent: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 75.0 }],
      networkRxBytesPerSec: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 1024 }],
      networkTxBytesPerSec: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 512 }],
      cpuFrequencyMHz: [],
      cpuTemperatureC: [],
      gpuEncodePercent: [],
      gpuDecodePercent: [],
      gpuFrequencyMHz: [],
      gpuMemoryUsagePercent: [],
      gpuTemperatureC: [],
      swapUsagePercent: [],
      memoryUsedBytes: [],
      swapUsedBytes: [],
      memoryAvailableBytes: [],
      memoryCachedBytes: [],
      memoryCommittedBytes: [],
      systemProcessCount: [],
      systemThreadCount: [],
      systemHandleCount: [],
      diskUsedBytes: [],
      diskReadBytesPerSec: [],
      diskWriteBytesPerSec: [],
      trafficRxBytes: [],
      trafficTxBytes: [],
      cpus: [],
      disks: [],
      networks: [],
      gpus: [],
      fans: []
    }
  };

  const normalized = normalizeMetricsResponse(sampleMetrics as MetricsResponse);
  assert.strictEqual(normalized.length, 1);
  assert.strictEqual(normalized[0].timestamp, "2026-08-05T08:00:00.000Z");
  assert.strictEqual(normalized[0].cpuUsage, 25);
  assert.strictEqual(normalized[0].memoryUsage, 50);
  assert.strictEqual(normalized[0].gpuUsage, 10);
  assert.strictEqual(normalized[0].diskUsage, 75);
  assert.strictEqual(normalized[0].rxRate, 1024);
  assert.strictEqual(normalized[0].txRate, 512);
});

test("formatBytes correctly formats byte values", () => {
  assert.strictEqual(formatBytes(0), "0 B");
  assert.strictEqual(formatBytes(1024), "1.0 KB");
  assert.strictEqual(formatBytes(1048576), "1.0 MB");
  assert.strictEqual(formatBytes(1073741824), "1.0 GB");
});
