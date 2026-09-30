import React, { useState } from "react";
import { M3Button } from "../../m3e/primitives";

/**
 * 固定布局里唯一的卡片实现。
 *
 * 外壳是 M3E 的填充卡片（圆角 16、surface-container-low）。
 * 视觉细节全部由 `m3e/components.css` 与 `workspace.dashboard.css` 以令牌表达。
 */
export interface ChartTileProps {
  title: string;
  /** 卡片上方的分类标签，通常来自分区的 eyebrow。 */
  eyebrow?: string;
  /** 标题下方的补充说明，通常放实时容量摘要。 */
  subtitle?: string;
  /** 头部右侧的操作区。 */
  controls?: React.ReactNode;
  /** 核心最新指标值（如 24.5% 或 12.4 MB/s），直接大字号呈现于头部。 */
  heroStat?: string;
  /** 核心指标旁的小徽章/极值统计（如 峰值 78% · 均值 35%）。 */
  heroBadge?: string;
  /** 查点/选点提示信息，呈现于大字下方（如 选中点 45% (17:38:02)） */
  inspectedStat?: string;
  /** 图表主体。 */
  children?: React.ReactNode;
  /** 无数据时的提示；给出后主体被替换成提示文本。 */
  emptyMessage?: string;
  /** 「详细信息」视图。给出后头部自动出现切换按钮，在图表与明细之间切换。 */
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
  heroStat,
  heroBadge,
  inspectedStat,
  children,
  emptyMessage,
  details,
  footer,
  className = ""
}: ChartTileProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsVisible = Boolean(details) && !emptyMessage && showDetails;

  return (
    <article className={`m3e-card m3e-card--filled chart-tile${className ? ` ${className}` : ""}`}>
      <div className="chart-tile__header">
        <div className="chart-tile__titles">
          {eyebrow ? <span className="chart-tile__eyebrow">{eyebrow}</span> : null}
          <div className="chart-tile__title-row">
            <h3 className="chart-tile__title">{title}</h3>
            {heroStat ? (
              <div className="chart-tile__hero-stat">
                <span className="chart-tile__hero-value">{heroStat}</span>
                {heroBadge ? <span className="chart-tile__hero-badge">{heroBadge}</span> : null}
              </div>
            ) : null}
          </div>
          {inspectedStat ? (
            <p className="chart-tile__inspected-stat">{inspectedStat}</p>
          ) : subtitle ? (
            <p className="chart-tile__subtitle">{subtitle}</p>
          ) : null}
        </div>
        {controls || details ? (
          <div className="chart-tile__controls">
            {controls}
            {details && !emptyMessage ? (
              <M3Button
                variant="text"
                size="sm"
                type="button"
                aria-pressed={detailsVisible}
                onClick={() => setShowDetails((value) => !value)}
              >
                {detailsVisible ? "返回图表" : "详细信息"}
              </M3Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {emptyMessage ? (
        <div className="chart-tile__empty">{emptyMessage}</div>
      ) : detailsVisible ? (
        <div className="chart-tile__body guanlan-fade-in">{details}</div>
      ) : children ? (
        <div className="chart-tile__body guanlan-fade-in">{children}</div>
      ) : null}

      {footer && !detailsVisible ? <div className="chart-tile__footer">{footer}</div> : null}
    </article>
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
