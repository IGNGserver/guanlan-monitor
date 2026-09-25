import React from "react";
import { CHART_SPANS, DEFAULT_CHART_SPAN, type ChartSpanName } from "./types";

/**
 * 固定布局的栅格容器。
 *
 * 自建 CSS Grid，不再组合 Carbon 的 `Grid` / `Row` / `Column`。css-grid 模式下
 * 行与列跨度完全依赖 @carbon/styles 的网格模块：该模块的 `.cds--row` 与
 * `.cds--css-grid-column` 规则没有随样式入口产出时，行会退化成普通块级盒子，
 * 被外层 `display: grid` 压进一条隐式轨道，整排磁贴随之塌缩成标题的宽度。
 * 固定布局的跨度完全由 DEVICE_DASHBOARD 声明，这里只需要一个确定性的网格，
 * 断点与列数沿用 Carbon 2x Grid 的约定：320/672/1056 对应 4/8/16 列。
 */
export function DashboardGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`dashboard-grid${className ? ` ${className}` : ""}`}>{children}</div>;
}

/**
 * 栅格单元。
 *
 * 三个断点的跨度以自定义属性下发，`dashboard.css` 在对应断点用
 * `grid-column: span var(--cell-*)` 取值；属性缺失时逐级回退到更窄断点的值。
 */
export function DashboardCell({
  span = DEFAULT_CHART_SPAN,
  id,
  className = "",
  children
}: {
  span?: ChartSpanName;
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const resolved = CHART_SPANS[span];
  const cellStyle = {
    "--cell-sm": resolved.sm,
    "--cell-md": resolved.md,
    "--cell-lg": resolved.lg
  } as React.CSSProperties;
  return (
    <div id={id} className={`dashboard-cell${className ? ` ${className}` : ""}`} style={cellStyle}>
      {children}
    </div>
  );
}
