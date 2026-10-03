import React from "react";
import { CHART_SPANS, DEFAULT_CHART_SPAN, type ChartSpanName } from "./types";

/**
 * 固定布局的栅格容器。
 *
 * 自建 CSS Grid：跨度完全由 `DEVICE_DASHBOARD` 的常量声明，`dashboard.css`
 * 依据容器宽度在 4 / 8 / 16 列之间用 `grid-column: span var(--cell-*)` 取值。
 * 这里只提供一个确定性的网格，不依赖任何第三方栅格或断点系统。
 */
export function DashboardGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className="dashboard-grid-container"><div className={`dashboard-grid${className ? ` ${className}` : ""}`}>{children}</div></div>;
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
