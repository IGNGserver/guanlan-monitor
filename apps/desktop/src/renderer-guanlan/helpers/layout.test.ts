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
      gpuMemoryUsedBytes: [],
      gpuTemperatureC: [],
      swapUsagePercent: [],
      memoryUsedBytes: [],
      swapUsedBytes: [],
      memoryAvailableBytes: [],
      memoryCachedBytes: [],
      memoryCommittedBytes: [],
      memoryCommitLimitBytes: [],
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

test("placementStyle computes dimensions and CSS order based on placement coordinates", async () => {
  const { placementStyle } = await import("./widgetGrid.ts");
  const style1 = placementStyle({ x: 1, y: 1, w: 2, h: 2, size: "medium", hidden: false });
  assert.strictEqual(style1.order, 1);
  assert.strictEqual(style1["--widget-w"], 2);
  assert.strictEqual(style1["--widget-h"], 2);

  const style2 = placementStyle({ x: 3, y: 1, w: 2, h: 2, size: "medium", hidden: false });
  assert.strictEqual(style2.order, 3);

  const style3 = placementStyle({ x: 1, y: 3, w: 4, h: 2, size: "large", hidden: false });
  assert.strictEqual(style3.order, 201);
});

test("findNextFreePlacement correctly reuses freed column space on the first row", async () => {
  const { findNextFreePlacement } = await import("./widgetGrid.ts");
  const placements = {
    widgetB: { x: 3, y: 1, w: 2, h: 2, size: "medium" as const, hidden: false }
  };
  // Slot at (1, 1) is free. Even if preferredX is 3, searching for a free placement must find (1, 1) rather than (1, 2)
  const pos = findNextFreePlacement(placements, "medium", 3, 1);
  assert.deepStrictEqual(pos, { x: 1, y: 1 });
});

test("moveWidgetWithAvoidance reorders widgets and packs them compactly without overlap", async () => {
  const { moveWidgetWithAvoidance } = await import("./widgetGrid.ts");
  const layout = {
    version: 4,
    snapToGrid: true,
    catalog: {
      w1: { title: "W1", kind: "content" as const, defaultSize: "medium" as const },
      w2: { title: "W2", kind: "content" as const, defaultSize: "medium" as const },
      w3: { title: "W3", kind: "content" as const, defaultSize: "large" as const }
    },
    placements: {
      w1: { x: 1, y: 1, w: 2, h: 2, size: "medium" as const, hidden: false },
      w2: { x: 3, y: 1, w: 2, h: 2, size: "medium" as const, hidden: false },
      w3: { x: 1, y: 3, w: 4, h: 2, size: "large" as const, hidden: false }
    }
  };

  // Drag w3 to w1
  const afterDragW3ToW1 = moveWidgetWithAvoidance(layout, "w3", "w1");
  assert.deepStrictEqual(afterDragW3ToW1.placements.w3, { x: 1, y: 1, w: 4, h: 2, size: "large", hidden: false });
  assert.deepStrictEqual(afterDragW3ToW1.placements.w1, { x: 1, y: 3, w: 2, h: 2, size: "medium", hidden: false });
  assert.deepStrictEqual(afterDragW3ToW1.placements.w2, { x: 3, y: 3, w: 2, h: 2, size: "medium", hidden: false });

  // Drag w1 to w2 (swapping on row 1)
  const afterDragW1ToW2 = moveWidgetWithAvoidance(layout, "w1", "w2");
  assert.deepStrictEqual(afterDragW1ToW2.placements.w2, { x: 1, y: 1, w: 2, h: 2, size: "medium", hidden: false });
  assert.deepStrictEqual(afterDragW1ToW2.placements.w1, { x: 3, y: 1, w: 2, h: 2, size: "medium", hidden: false });
  assert.deepStrictEqual(afterDragW1ToW2.placements.w3, { x: 1, y: 3, w: 4, h: 2, size: "large", hidden: false });
});
