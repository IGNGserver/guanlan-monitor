import assert from "node:assert";
import test from "node:test";
import {
  DEFAULT_DEVICE_TAB_ID,
  DEVICE_DASHBOARD,
  DEVICE_TAB_IDS,
  deviceTabAnchors,
  findDeviceTab
} from "./deviceDashboard.ts";
import { CHART_SPANS, dashboardSectionIds, findDashboardTab, isChartAvailable, resolveChartSpan } from "./types.ts";
import type { DashboardChartSpec, DashboardSectionSpec } from "./types.ts";

/**
 * 固定布局常量的运行期不变量。
 *
 * 类型系统已经保证了「每张图表都有渲染器」和「`requires` 里的指标名合法」，
 * 但下面这些约束它管不了，而每一条被破坏都会在页面上留下很难查的症状：
 * 分区 id 同时是 DOM 锚点和 IntersectionObserver 的目标，重复会让页内跳转条
 * 指到错误的分区；图表 id 是 React key，重复会让切换实例筛选时卡片串数据。
 */

const allTabs = DEVICE_DASHBOARD.tabs;
const allSections: DashboardSectionSpec[] = allTabs.flatMap((tab) => tab.sections);
const allCharts: DashboardChartSpec[] = allSections.flatMap((section) => section.charts);

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

test("fixed layout keeps tab, section and chart ids unique", () => {
  assert.ok(allTabs.length >= 3, "device dashboard must keep the consolidated tab set");
  assert.deepStrictEqual(duplicates(allTabs.map((tab) => tab.id)), [], "tab ids must be unique");
  // 分区 id 是页内锚点，必须跨选项卡唯一，否则跳转条会同时命中两个分区。
  assert.deepStrictEqual(duplicates(allSections.map((section) => section.id)), [], "section ids are DOM anchors and must be globally unique");
  assert.deepStrictEqual(duplicates(allCharts.map((chart) => chart.id)), [], "chart ids are React keys and must be globally unique");
});

test("fixed layout never declares an empty tab or section", () => {
  for (const tab of allTabs) {
    assert.ok(tab.name.trim().length > 0, `tab ${tab.id} must have a visible name`);
    assert.ok(tab.sections.length > 0, `tab ${tab.id} must render at least one section`);
  }
  for (const section of allSections) {
    assert.ok(section.title.trim().length > 0, `section ${section.id} must have a visible title`);
    assert.ok(section.charts.length > 0, `section ${section.id} must render at least one chart`);
  }
});

test("every chart resolves to a responsive Carbon grid span", () => {
  for (const chart of allCharts) {
    const span = resolveChartSpan(chart);
    assert.ok(span, `chart ${chart.id} declares an unknown span`);
    for (const breakpoint of ["sm", "md", "lg"] as const) {
      assert.ok(span[breakpoint] > 0, `chart ${chart.id} must span columns at ${breakpoint}`);
    }
    // 窄屏不能比宽屏占更多列，否则 390px 下会出现横向溢出。
    assert.ok(span.sm <= span.md && span.md <= span.lg, `chart ${chart.id} span must not grow towards narrow breakpoints`);
  }
  assert.deepStrictEqual(Object.keys(CHART_SPANS).sort(), ["full", "half", "quarter", "wide"], "span tiers are a closed set");
});

test("DEVICE_TAB_IDS and DEFAULT_DEVICE_TAB_ID stay in sync with the constant", () => {
  assert.deepStrictEqual([...DEVICE_TAB_IDS], allTabs.map((tab) => tab.id), "exported tab ids must follow declaration order");
  assert.strictEqual(DEFAULT_DEVICE_TAB_ID, allTabs[0].id, "default tab must be the first declared tab");
});

test("findDeviceTab falls back to the first tab for unknown ids", () => {
  assert.strictEqual(findDeviceTab(DEFAULT_DEVICE_TAB_ID).id, DEFAULT_DEVICE_TAB_ID);
  for (const tab of allTabs) {
    assert.strictEqual(findDeviceTab(tab.id).id, tab.id, `findDeviceTab must resolve ${tab.id}`);
  }
  // 旧的六选项卡布局里存在 fan / all 这两个 id；线上仍可能从历史记录里带过来。
  assert.strictEqual(findDeviceTab("fan").id, allTabs[0].id, "a retired tab id must fall back instead of rendering nothing");
  assert.strictEqual(findDeviceTab("").id, allTabs[0].id);
  assert.strictEqual(findDashboardTab(DEVICE_DASHBOARD, "fan").id, allTabs[0].id, "the generic resolver must share the fallback");
});

test("deviceTabAnchors exposes exactly one anchor per section", () => {
  for (const tab of allTabs) {
    const anchors = deviceTabAnchors(tab);
    assert.deepStrictEqual(anchors.map((anchor) => anchor.id), dashboardSectionIds(tab), `anchors of ${tab.id} must match its sections in order`);
    assert.ok(anchors.every((anchor) => anchor.label.trim().length > 0), `anchors of ${tab.id} must carry a visible label`);
  }
});

test("isChartAvailable honours the declared metric requirements", () => {
  const chart = allCharts.find((entry) => (entry.requires?.length ?? 0) >= 2);
  assert.ok(chart, "the fixed layout must contain at least one chart with multiple metric requirements");
  assert.strictEqual(isChartAvailable(chart, () => false), true, "no unavailable metric means the chart renders");
  assert.strictEqual(isChartAvailable(chart, (key) => key === chart!.requires![0]), false, "a single unavailable metric must blank the chart");

  const withoutRequires = allCharts.find((entry) => !entry.requires || entry.requires.length === 0);
  assert.ok(withoutRequires, "the fixed layout must contain at least one chart that needs no metric");
  assert.strictEqual(isChartAvailable(withoutRequires, () => true), true, "static charts stay available even when every metric is missing");
});
