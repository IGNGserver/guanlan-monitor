import React, { useState } from "react";
import { Button, Tile } from "@carbon/react";

/**
 * 固定布局里唯一的卡片实现。
 *
 * 外壳直接用 Carbon 官方 `Tile`，不再叠 `Surface` / `DeviceWidgetFrame` /
 * `.telemetry-chart-card` 三层各自定义圆角、边框和阴影的容器——那正是原先
 * 卡片观感混乱的来源。视觉细节全部由 `dashboard.css` 用 Carbon 令牌覆盖。
 */
export interface ChartTileProps {
  title: string;
  /** 卡片上方的分类标签，通常来自分区的 eyebrow。 */
  eyebrow?: string;
  /** 标题下方的补充说明，通常放实时容量摘要。 */
  subtitle?: string;
  /** 头部右侧的操作区。 */
  controls?: React.ReactNode;
  /** 图表主体。 */
  children?: React.ReactNode;
  /** 无数据时的提示；给出后主体被替换成提示文本。 */
  emptyMessage?: string;
  /**
   * 「详细信息」视图。给出后头部自动出现切换按钮，在图表与明细之间切换，
   * 取代原先散落在各处的 `showDetailsControl`。
   */
  details?: React.ReactNode;
  /** 底部附注，例如已采集硬件型号列表。 */
  footer?: React.ReactNode;
  className?: string;
}

export function ChartTile({
  title,
  eyebrow,
  subtitle,
  controls,
  children,
  emptyMessage,
  details,
  footer,
  className = ""
}: ChartTileProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsVisible = Boolean(details) && !emptyMessage && showDetails;

  return (
    <Tile className={`chart-tile${className ? ` ${className}` : ""}`}>
      <div className="chart-tile__header">
        <div className="chart-tile__titles">
          {eyebrow ? <span className="chart-tile__eyebrow">{eyebrow}</span> : null}
          <h3 className="chart-tile__title">{title}</h3>
          {subtitle ? <p className="chart-tile__subtitle">{subtitle}</p> : null}
        </div>
        {controls || details ? (
          <div className="chart-tile__controls">
            {controls}
            {details && !emptyMessage ? (
              <Button
                kind="ghost"
                size="sm"
                type="button"
                aria-pressed={detailsVisible}
                onClick={() => setShowDetails((value) => !value)}
              >
                {detailsVisible ? "返回图表" : "详细信息"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {emptyMessage ? (
        <div className="chart-tile__empty">{emptyMessage}</div>
      ) : detailsVisible ? (
        <div className="chart-tile__body chart-tile__body--details guanlan-fade-in">{details}</div>
      ) : children ? (
        <div className="chart-tile__body guanlan-fade-in">{children}</div>
      ) : null}

      {footer && !detailsVisible ? <div className="chart-tile__footer">{footer}</div> : null}
    </Tile>
  );
}

/**
 * 分区外壳。
 *
 * 一个分区对应固定布局里的一个锚点，页内跳转条与 IntersectionObserver 都以
 * `section.id` 为目标，所以这里的 `id` 必须来自布局常量而不是运行时拼接。
 */
export function DashboardSection({
  id,
  eyebrow,
  title,
  description,
  controls,
  children
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="dashboard-section__header">
        <div className="dashboard-section__copy">
          {eyebrow ? <span className="dashboard-section__eyebrow">{eyebrow}</span> : null}
          <h2 className="dashboard-section__title" id={`${id}-title`}>{title}</h2>
          {description ? <p className="dashboard-section__description">{description}</p> : null}
        </div>
        {controls ? <div className="dashboard-section__controls">{controls}</div> : null}
      </header>
      {children}
    </section>
  );
}
