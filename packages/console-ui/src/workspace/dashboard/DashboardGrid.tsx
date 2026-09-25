import React from "react";
import { Column, Grid, Row } from "@carbon/react";
import { CHART_SPANS, DEFAULT_CHART_SPAN, type ChartSpanName } from "./types";

/**
 * 固定布局的栅格容器。
 *
 * 直接建在 Carbon 2x Grid 上，取代原来 `.workspace-widget-grid` 那套自绘的
 * 4 列拖拽网格：跨度由布局常量声明，运行期不再有 `--widget-w` 这类内联变量。
 */
export function DashboardGrid({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <Grid className={`dashboard-grid${className ? ` ${className}` : ""}`} fullWidth withRowGap>
      <Row>{children}</Row>
    </Grid>
  );
}

/**
 * 栅格单元。
 *
 * `Column` 的泛型参数没有默认值，必须显式传 `as="div"` 才能推断出 div 的
 * 原生属性（例如 `id`），否则 `id` 会被判为未知属性。
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
  children: React.ReactNode;
}) {
  const resolved = CHART_SPANS[span];
  return (
    <Column
      as="div"
      id={id}
      className={`dashboard-cell${className ? ` ${className}` : ""}`}
      sm={resolved.sm}
      md={resolved.md}
      lg={resolved.lg}
    >
      {children}
    </Column>
  );
}
