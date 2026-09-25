/**
 * 固定图表布局层。
 *
 * 这一层取代小组件机制：布局由 `deviceDashboard.ts` 的常量在编译期固定，
 * 卡片统一走 `ChartTile`，栅格统一走 Carbon 2x Grid，图表统一走 Carbon Charts。
 */
export {
  CHART_SPANS,
  DEFAULT_CHART_SPAN,
  dashboardSectionIds,
  findDashboardTab,
  isChartAvailable,
  resolveChartSpan,
  type ChartSpan,
  type ChartSpanName,
  type ChartVisualization,
  type DashboardChartSpec,
  type DashboardSectionSpec,
  type DashboardSpec,
  type DashboardTabSpec,
  type MetricAvailability
} from "./types";

export {
  DEFAULT_DEVICE_TAB_ID,
  DEVICE_DASHBOARD,
  DEVICE_TAB_IDS,
  deviceTabAnchors,
  findDeviceTab,
  type DeviceChartId,
  type DeviceSectionId,
  type DeviceTabId
} from "./deviceDashboard";

export { ChartTile, DashboardSection, type ChartTileProps } from "./ChartTile";
export { DashboardCell, DashboardGrid } from "./DashboardGrid";
