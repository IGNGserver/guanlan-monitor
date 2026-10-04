import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { M3Button } from "../../m3e/primitives";
import { Icon } from "../../m3e/icons";

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
  /** 标题下方的补充说明。给出 `sheet` 时不在卡片上常驻，由调用方放进半屏详情。 */
  subtitle?: string;
  /** 头部右侧的操作区。 */
  controls?: React.ReactNode;
  /** 核心最新指标值（如 24.5% 或 12.4 MB/s），直接大字号呈现于头部。 */
  heroStat?: string;
  /** 核心指标旁的小徽章/极值统计（如 峰值 78% · 均值 35%）。 */
  heroBadge?: string;
  /** 最新或查点读数，在同一位置展示各条曲线与采样时间。 */
  readout?: React.ReactNode;
  /** 图表主体。 */
  children?: React.ReactNode;
  /** 无数据时的提示；给出后主体被替换成提示文本。 */
  emptyMessage?: string;
  /**
   * 半屏详情。给出后头部出现「展开 / 收回」，内容从卡片底部滑出覆盖下半部分；
   * 此时 `subtitle` 与 `footer` 不再常驻卡片，调用方负责把它们放进详情。
   */
  sheet?: React.ReactNode;
  /** 底部附注；只在没有 `sheet` 的卡片上常驻。 */
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
  readout,
  children,
  emptyMessage,
  sheet,
  footer,
  className = ""
}: ChartTileProps) {
  const sheetId = useId();
  const tileRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  // 详情首次展开才挂载，之后保留，收回时才有退场动画可放。
  const [sheetMounted, setSheetMounted] = useState(false);
  const hasSheet = Boolean(sheet) && !emptyMessage;
  const open = hasSheet && expanded;

  useEffect(() => {
    if (open) setSheetMounted(true);
  }, [open]);

  // 详情的上限是头部底边：标题换行或手机上控件折到下一行时头部会变高，
  // 所以展开期间跟着卡片尺寸重新量，而不是写死一个高度。
  useLayoutEffect(() => {
    const tile = tileRef.current;
    const header = tile?.querySelector<HTMLElement>(".chart-tile__header");
    if (!open || !tile || !header) return;
    const measure = () => tile.style.setProperty("--chart-sheet-top", `${header.offsetTop + header.offsetHeight + 8}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(tile);
    return () => observer.disconnect();
  }, [open]);

  const collapse = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setExpanded(false);
    // 详情即将 inert，焦点若留在里面会掉回 body。
    tileRef.current?.querySelector<HTMLButtonElement>(".chart-tile__sheet-toggle")?.focus();
  };

  return (
    <article ref={tileRef} className={`m3e-card m3e-card--filled chart-tile${hasSheet ? ` chart-tile--sheet${controls ? "" : " chart-tile--toggle-only"}` : ""}${open ? " is-sheet-open" : ""}${className ? ` ${className}` : ""}`}>
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
          {subtitle && !hasSheet ? (
            <p className="chart-tile__subtitle">{subtitle}</p>
          ) : null}
        </div>
        {controls || hasSheet ? (
          <div className="chart-tile__controls">
            {controls}
            {hasSheet ? (
              <M3Button
                className="chart-tile__sheet-toggle"
                variant="text"
                size="sm"
                type="button"
                aria-expanded={open}
                aria-controls={sheetId}
                trailingIcon={<Icon name={open ? "chevron" : "chevronUp"} size={18} />}
                onClick={() => setExpanded((value) => !value)}
                onKeyDown={collapse}
              >
                {open ? "收回" : "展开"}
              </M3Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {readout && !emptyMessage ? <div className="chart-tile__readout">{readout}</div> : null}

      {emptyMessage ? (
        <div className="chart-tile__empty">{emptyMessage}</div>
      ) : children ? (
        <div className="chart-tile__body guanlan-fade-in">{children}</div>
      ) : null}

      {footer && !hasSheet ? <div className="chart-tile__footer">{footer}</div> : null}

      {hasSheet ? (
        <section
          id={sheetId}
          className="chart-tile__sheet"
          aria-label={`${title}详情`}
          data-open={open ? "true" : "false"}
          inert={!open || undefined}
          onKeyDown={collapse}
        >
          <div className="chart-tile__sheet-content">{sheetMounted || open ? sheet : null}</div>
        </section>
      ) : null}
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
