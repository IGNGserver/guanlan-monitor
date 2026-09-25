import type { DeviceBlockKey, DeviceMetricKey } from "@dsc/shared";

/**
 * 固定图表布局的类型契约。
 *
 * 小组件机制移除后，这里是唯一描述「一张图表长什么样」的地方。它刻意不包含
 * 任何坐标、模板 id、快照或用户可编辑状态：布局由 `deviceDashboard.ts` 里的
 * 常量在编译期固定，运行期只读。
 */

/**
 * 图表可视化类型。
 *
 * - `line` / `area` / `bar` 走 Carbon Charts 的笛卡尔时间序列图；
 * - `donut` / `meter` 走 Carbon Charts 的占比与仪表图，替代原先手绘的
 *   `CompositionMeter` 与 `MeterView`；
 * - `number` 是纯数值读数网格；
 * - `table` 走 Carbon `StructuredList`；
 * - `custom` 表示该位置渲染页面自带的复合组件（例如流量日历、温度传感器面板），
 *   仍然由 `ChartTile` 提供统一的卡片外壳。
 */
export type ChartVisualization =
  | "line"
  | "area"
  | "bar"
  | "donut"
  | "meter"
  | "number"
  | "table"
  | "custom";

/**
 * Carbon 2x Grid 的断点跨度。
 *
 * `sm` 是 4 列、`md` 是 8 列、`lg`（以及 `xlg` / `max`）是 16 列。这里只声明到
 * `lg` 为止：更大的断点沿用 `lg` 的跨度，避免出现 16 列布局里塞不下的组合。
 */
export interface ChartSpan {
  sm: number;
  md: number;
  lg: number;
}

/** 预设跨度档位。命名档位而不是裸数字，是为了让固定布局在常量里可读。 */
export type ChartSpanName = "full" | "wide" | "half" | "quarter";

export const CHART_SPANS: Record<ChartSpanName, ChartSpan> = {
  full: { sm: 4, md: 8, lg: 16 },
  wide: { sm: 4, md: 8, lg: 12 },
  half: { sm: 4, md: 4, lg: 8 },
  quarter: { sm: 2, md: 2, lg: 4 }
};

export const DEFAULT_CHART_SPAN: ChartSpanName = "half";

/** 单张图表在固定布局里的声明。 */
export interface DashboardChartSpec {
  /** 稳定标识，同时作为 React key、DOM 锚点与视觉回归测试的钩子。 */
  id: string;
  title: string;
  /** 卡片副标题；页面通常会用实时容量摘要覆盖它。 */
  subtitle?: string;
  visualization: ChartVisualization;
  span?: ChartSpanName;
  /**
   * 该图表依赖的指标。任一指标被设备标记为不适用时，页面渲染「本机不适用」
   * 提示而不是画一张空图。
   */
  requires?: readonly DeviceMetricKey[];
  /**
   * 按设备实例重复渲染的图表族。页面会把对应硬件块的每个实例展开成一张
   * 同规格图表，并沿用实例筛选器的选择结果。
   */
  perInstance?: DeviceBlockKey;
  /** 密集网格里使用的矮图表。 */
  compact?: boolean;
}

/** 固定布局里的一个分区，对应页内一个可跳转锚点。 */
export interface DashboardSectionSpec {
  /** 锚点 id，页内跳转与 IntersectionObserver 都基于它。 */
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  readonly charts: readonly DashboardChartSpec[];
}

/** 设备详情页的一个选项卡。 */
export interface DashboardTabSpec {
  id: string;
  name: string;
  /** 选项卡副标题，用于在标签栏下方说明这个页签覆盖的范围。 */
  caption?: string;
  readonly sections: readonly DashboardSectionSpec[];
}

/**
 * 一份完整的固定布局。
 *
 * 所有集合都是 readonly：布局常量用 `as const satisfies DashboardSpec` 声明，
 * 这样既能保留字面量类型（供 `DeviceChartId` 这类推导使用），又能在编译期
 * 阻止运行期改写布局。
 */
export interface DashboardSpec {
  id: string;
  readonly tabs: readonly DashboardTabSpec[];
}

/** 判断某个指标是否不可用的回调，由页面结合设备能力注入。 */
export type MetricAvailability = (key: DeviceMetricKey) => boolean;

export function resolveChartSpan(chart: DashboardChartSpec): ChartSpan {
  return CHART_SPANS[chart.span ?? DEFAULT_CHART_SPAN];
}

export function findDashboardTab(dashboard: DashboardSpec, tabId: string): DashboardTabSpec {
  return dashboard.tabs.find((tab) => tab.id === tabId) ?? dashboard.tabs[0];
}

/** 分区锚点 id 列表，供页内跳转条使用。 */
export function dashboardSectionIds(tab: DashboardTabSpec): string[] {
  return tab.sections.map((section) => section.id);
}

/**
 * 图表是否可渲染。`unavailable` 返回 true 表示该指标被设备标记为不适用。
 * 没有声明 `requires` 的图表（例如设备信息表）始终可渲染。
 */
export function isChartAvailable(chart: DashboardChartSpec, unavailable: MetricAvailability): boolean {
  const requires = chart.requires;
  if (!requires || requires.length === 0) return true;
  return !requires.some((key) => unavailable(key));
}
