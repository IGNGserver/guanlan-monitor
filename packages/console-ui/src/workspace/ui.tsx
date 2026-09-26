import React, { useEffect, useRef, useState } from "react";
import { Layer } from "@carbon/react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Checkmark,
  ChevronDown,
  ChevronUp,
  Close,
  Cloud,
  CollapseCategories,
  ConnectionSignal,
  Copy,
  Dashboard,
  DataBase,
  Devices,
  Grid,
  Information,
  Keyboard,
  Launch,
  Maximize,
  Minimize,
  OverflowMenuHorizontal,
  Renew,
  Search,
  Settings,
  TrashCan,
  Time,
  type CarbonIconType,
  WarningAlt
} from "@carbon/react/icons";
import { M3Button } from "./m3";

export type IconName =
  | "overview"
  | "hub"
  | "device"
  | "settings"
  | "back"
  | "search"
  | "refresh"
  | "collapse"
  | "chevron"
  | "external"
  | "copy"
  | "warning"
  | "check"
  | "clock"
  | "agent"
  | "appearance"
  | "connection"
  | "data"
  | "keyboard"
  | "about"
  | "arrow"
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  | "windowClose"
  | "more"
  | "chevronUp"
  | "delete";

const carbonIcons: Record<IconName, CarbonIconType> = {
  overview: Dashboard,
  hub: Cloud,
  device: Devices,
  settings: Settings,
  back: ArrowLeft,
  search: Search,
  refresh: Renew,
  collapse: CollapseCategories,
  chevron: ChevronDown,
  chevronUp: ChevronUp,
  external: Launch,
  copy: Copy,
  warning: WarningAlt,
  check: Checkmark,
  clock: Time,
  agent: Bot,
  appearance: Grid,
  connection: ConnectionSignal,
  data: DataBase,
  keyboard: Keyboard,
  about: Information,
  arrow: ArrowRight,
  windowMinimize: Minimize,
  windowMaximize: Maximize,
  windowRestore: Maximize,
  windowClose: Close,
  more: OverflowMenuHorizontal,
  delete: TrashCan
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const CarbonIcon = carbonIcons[name];
  return <CarbonIcon className="workspace-icon" size={size} aria-hidden="true" />;
}

export function Button({
  children,
  onClick,
  variant = "secondary",
  className = "",
  disabled = false,
  type = "button",
  title,
  autoFocus = false,
  ...props
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  autoFocus?: boolean;
  /**
   * TypeScript lets any hyphenated JSX attribute through, so a caller could
   * already write `aria-label` here - but it used to be dropped on the floor,
   * which left icon-only buttons with no accessible name at all.
   */
  "aria-label"?: string;
}) {
  const m3Variant = variant === "primary" ? "filled" : variant === "secondary" ? "outlined" : variant === "quiet" ? "text" : "danger";
  return (
    <M3Button className={`workspace-button workspace-button--${variant} ${className}`} autoFocus={autoFocus} disabled={disabled} onClick={onClick} type={type} title={title} variant={m3Variant} {...props}>
      {children}
    </M3Button>
  );
}

export function StatusDot({ state }: { state: "online" | "offline" | "cached" | "warning" | "unknown" }) {
  return <span className={`workspace-status-dot workspace-status-dot--${state}`} aria-hidden="true" />;
}

export function StatusLabel({ state, compact = false }: { state: "online" | "offline" | "cached" | "warning" | "unknown"; compact?: boolean }) {
  const labels = { online: "在线", offline: "离线", cached: "缓存", warning: "异常", unknown: "未连接" };
  return (
    <span className={`workspace-status-label workspace-status-label--${state} ${compact ? "is-compact" : ""}`}>
      <StatusDot state={state} />
      {!compact && labels[state]}
    </span>
  );
}

export function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Layer as="section" className={`workspace-surface ${className}`}>{children}</Layer>;
}
export function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}

/**
 * A copy control that answers back. `navigator.clipboard` is unavailable over
 * plain http and can be refused by the desktop shell, and the previous
 * fire-and-forget buttons looked identical whether the text landed or not, so
 * the outcome is announced next to a stable button name.
 */
export function CopyButton({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);
  const announce = (next: "copied" | "failed") => {
    setResult(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setResult(null), 2400);
  };
  const copy = () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      announce("failed");
      return;
    }
    clipboard.writeText(text).then(
      () => announce("copied"),
      () => announce("failed")
    );
  };
  return (
    <span className={`workspace-copy ${className}`}>
      <Button variant="quiet" onClick={copy} title={label}><Icon name="copy" size={15} />{label}</Button>
      <span className="workspace-copy__state" role="status" aria-live="polite">{result === "copied" ? "已复制" : result === "failed" ? "复制失败，请手动选中复制" : ""}</span>
    </span>
  );
}

