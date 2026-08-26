import assert from "node:assert";
import test from "node:test";
import { getLayoutClass, getScreenOrientation, getResponsiveTier } from "./layout.ts";
import { resolveInteractionScale, detectDefaultInteractionScale, detectTouchSupport } from "./density.ts";
import { resolveEffectiveTheme } from "./theme.ts";
import { normalizeMetricsResponse, formatBytes } from "./metricsNormalizer.ts";
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES, emptyConsoleSnapshot } from "../services/adapter.ts";
import type { MetricsResponse } from "@dsc/shared";
import { isDeclarativeWidgetDefinition, mergeDefinitions } from "./widgetLayout.ts";

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

test("getScreenOrientation and getResponsiveTier handle portrait and extreme breakpoints", () => {
  assert.strictEqual(getScreenOrientation(1920, 1080), "landscape");
  assert.strictEqual(getScreenOrientation(1080, 1920), "portrait");
  assert.strictEqual(getScreenOrientation(360, 800), "portrait");
  assert.strictEqual(getScreenOrientation(800, 360), "landscape");

  assert.strictEqual(getResponsiveTier(360), "xs");
  assert.strictEqual(getResponsiveTier(479), "xs");
  assert.strictEqual(getResponsiveTier(480), "sm");
  assert.strictEqual(getResponsiveTier(767), "sm");
  assert.strictEqual(getResponsiveTier(768), "md");
  assert.strictEqual(getResponsiveTier(1023), "md");
  assert.strictEqual(getResponsiveTier(1024), "lg");
  assert.strictEqual(getResponsiveTier(1439), "lg");
  assert.strictEqual(getResponsiveTier(1440), "xl");
});

test("detectTouchSupport runs safely without window environment", () => {
  assert.strictEqual(typeof detectTouchSupport(), "boolean");
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

test("shared console snapshot keeps platform state explicit", () => {
  const snapshot = emptyConsoleSnapshot();
  assert.strictEqual(snapshot.source, "empty");
  assert.strictEqual(snapshot.localBackend, null);
  assert.deepStrictEqual(snapshot.startup, { openAtLogin: false, startMinimized: false });
  assert.strictEqual(WEB_CAPABILITIES.canManageLocalAgent, false);
  assert.strictEqual(DESKTOP_CAPABILITIES.canManageLocalAgent, true);
  assert.strictEqual(WEB_CAPABILITIES.canControlNativeWindow, false);
  assert.strictEqual(DESKTOP_CAPABILITIES.canControlNativeWindow, true);
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
  assert.strictEqual(formatBytes(16 * 1073741824), "16.0 GB");
  assert.strictEqual(formatBytes(32 * 1073741824), "32.0 GB");
});

test("placementStyle computes dimensions and CSS order based on placement coordinates", async () => {
  const { placementStyle } = await import("./widgetGrid.ts");
  const style1 = placementStyle({ x: 1, y: 1, w: 2, h: 2, size: "medium" });
  assert.strictEqual(style1.order, 1);
  assert.strictEqual(style1["--widget-w"], 2);
  assert.strictEqual(style1["--widget-h"], 2);

  const style2 = placementStyle({ x: 3, y: 1, w: 2, h: 2, size: "medium" });
  assert.strictEqual(style2.order, 3);

  const style3 = placementStyle({ x: 1, y: 3, w: 4, h: 2, size: "large" });
  assert.strictEqual(style3.order, 201);

  const compactStyle = placementStyle({ x: 1, y: 1, w: 4, h: 4, size: "large" }, "large", undefined, undefined, 6);
  assert.strictEqual(compactStyle["--widget-h"], 4);
  assert.strictEqual(compactStyle["--widget-h-compact"], 6);
});

test("resizePlacement updates the persisted grid dimensions when a widget size changes", async () => {
  const { resizePlacement } = await import("./widgetGrid.ts");
  const resized = resizePlacement({ x: 3, y: 4, w: 1, h: 2, size: "small" }, "large");
  assert.deepStrictEqual(resized, { x: 1, y: 4, w: 4, h: 2, size: "large", hidden: false });
});

test("mergeDefinitions does not recreate deleted user widgets after a save response", () => {
  const standaloneDefinition = {
    id: "cpu-usage-instance",
    title: "CPU 使用率",
    kind: "content" as const,
    defaultSize: "medium" as const,
    widgetType: "cpu-usage"
  };
  assert.strictEqual(isDeclarativeWidgetDefinition(standaloneDefinition), false);

  const afterDelete = mergeDefinitions({ version: 4, snapToGrid: true, catalog: {}, placements: {} }, { [standaloneDefinition.id]: standaloneDefinition });
  assert.deepStrictEqual(afterDelete.catalog, {});
  assert.deepStrictEqual(afterDelete.placements, {});
});

test("mergeDefinitions still rehydrates system widgets declared by the page", () => {
  const systemDefinition = {
    id: "compute-memory",
    title: "内存容量明细",
    kind: "content" as const,
    defaultSize: "large" as const,
    widgetType: "memory-usage",
    config: { systemRendered: true }
  };
  assert.strictEqual(isDeclarativeWidgetDefinition(systemDefinition), true);

  const restored = mergeDefinitions({ version: 4, snapToGrid: true, catalog: {}, placements: {} }, { [systemDefinition.id]: systemDefinition });
  assert.strictEqual(restored.catalog[systemDefinition.id].config?.systemRendered, true);
  assert.ok(restored.placements[systemDefinition.id]);
});

test("normalizePlacements expands grouped device layouts from visible child count", async () => {
  const { normalizePlacements } = await import("./widgetGrid.ts");
  const catalog = {
    group: { title: "CPU", kind: "group" as const, defaultSize: "large" as const },
    chart1: { title: "使用率", kind: "content" as const, defaultSize: "medium" as const, groupId: "group" },
    chart2: { title: "频率", kind: "content" as const, defaultSize: "medium" as const, groupId: "group" },
    chart3: { title: "温度", kind: "content" as const, defaultSize: "medium" as const, groupId: "group" }
  };
  const normalized = normalizePlacements({
    group: { x: 1, y: 1, w: 4, h: 2, size: "large" },
    chart1: { x: 1, y: 1, w: 2, h: 2, size: "medium" },
    chart2: { x: 3, y: 1, w: 2, h: 2, size: "medium" },
    chart3: { x: 1, y: 3, w: 2, h: 2, size: "medium" }
  }, true, catalog);

  assert.strictEqual(normalized.group.h, 4);
  assert.strictEqual(normalized.chart1.x, 1);
  assert.strictEqual(normalized.chart2.x, 3);
  assert.strictEqual(normalized.chart3.y, 3);
});

test("findNextFreePlacement correctly reuses freed column space on the first row", async () => {
  const { findNextFreePlacement } = await import("./widgetGrid.ts");
  const placements = {
    widgetB: { x: 3, y: 1, w: 2, h: 2, size: "medium" as const }
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
      w1: { x: 1, y: 1, w: 2, h: 2, size: "medium" as const },
      w2: { x: 3, y: 1, w: 2, h: 2, size: "medium" as const },
      w3: { x: 1, y: 3, w: 4, h: 2, size: "large" as const }
    }
  };

  // Drag w3 to w1
  const afterDragW3ToW1 = moveWidgetWithAvoidance(layout, "w3", "w1");
  assert.deepStrictEqual(afterDragW3ToW1.placements.w3, { x: 1, y: 1, w: 4, h: 2, size: "large" });
  assert.deepStrictEqual(afterDragW3ToW1.placements.w1, { x: 1, y: 3, w: 2, h: 2, size: "medium" });
  assert.deepStrictEqual(afterDragW3ToW1.placements.w2, { x: 3, y: 3, w: 2, h: 2, size: "medium" });

  // Drag w1 to w2 (swapping on row 1)
  const afterDragW1ToW2 = moveWidgetWithAvoidance(layout, "w1", "w2");
  assert.deepStrictEqual(afterDragW1ToW2.placements.w2, { x: 1, y: 1, w: 2, h: 2, size: "medium" });
  assert.deepStrictEqual(afterDragW1ToW2.placements.w1, { x: 3, y: 1, w: 2, h: 2, size: "medium" });
  assert.deepStrictEqual(afterDragW1ToW2.placements.w3, { x: 1, y: 3, w: 4, h: 2, size: "large" });
});

test("getWidgetLines keeps GPU temperature per target and identifies shared iGPU memory", async () => {
  const { getWidgetLines } = await import("./widgetLines.ts");
  const sampleMetrics = {
    series: {
      gpuTemperatureC: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 49 }],
      gpuMemoryUsedBytes: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 1024 * 1024 * 1024 }],
      gpus: [
        {
          id: "gpu-nvidia",
          name: "NVIDIA GeForce RTX 2060 SUPER",
          integrated: false,
          memoryKind: "dedicated",
          usagePercent: [],
          encodePercent: [],
          decodePercent: [],
          frequencyMHz: [],
          memoryUsagePercent: [],
          memoryUsedBytes: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 1024 * 1024 * 1024 }],
          temperatureC: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 49 }]
        },
        {
          id: "gpu-intel",
          name: "Intel(R) UHD Graphics",
          integrated: true,
          memoryKind: "shared",
          usagePercent: [],
          encodePercent: [],
          decodePercent: [],
          frequencyMHz: [],
          memoryUsagePercent: [],
          memoryUsedBytes: [],
          temperatureC: [{ timestamp: "2026-08-05T08:00:00.000Z", value: 42 }],
          temperatureSource: "cpuPackageShared"
        }
      ]
    }
  } as unknown as MetricsResponse;

  // NVIDIA dGPU has temperature 49
  const nvidiaTemp = getWidgetLines("gpu-temperature", sampleMetrics, "gpu-nvidia");
  assert.strictEqual(nvidiaTemp.lines.length, 1);
  assert.deepStrictEqual(nvidiaTemp.lines[0].points, [{ timestamp: "2026-08-05T08:00:00.000Z", value: 49 }]);

  // Intel iGPU follows the CPU package temperature, but must not inherit the dGPU value.
  const intelTemp = getWidgetLines("gpu-temperature", sampleMetrics, "gpu-intel");
  assert.strictEqual(intelTemp.lines.length, 1);
  assert.deepStrictEqual(intelTemp.lines[0].points, [{ timestamp: "2026-08-05T08:00:00.000Z", value: 42 }]);

  const intelMemory = getWidgetLines("gpu-memory", sampleMetrics, "gpu-intel");
  assert.strictEqual(intelMemory.lines[0]?.label, "共享显存已用");

  // Summary (no targetId) -> returns global summary
  const summaryTemp = getWidgetLines("gpu-temperature", sampleMetrics);
  assert.strictEqual(summaryTemp.lines.length, 1);
  assert.deepStrictEqual(summaryTemp.lines[0].points, [{ timestamp: "2026-08-05T08:00:00.000Z", value: 49 }]);
});
