import React from "react";
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
  | "chevronUp";

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
  more: OverflowMenuHorizontal
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
  autoFocus = false
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  autoFocus?: boolean;
}) {
  const m3Variant = variant === "primary" ? "filled" : variant === "secondary" ? "outlined" : variant === "quiet" ? "text" : "danger";
  return (
    <M3Button className={`workspace-button workspace-button--${variant} ${className}`} autoFocus={autoFocus} disabled={disabled} onClick={onClick} type={type} title={title} variant={m3Variant}>
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

export function virtualMachinePowerState(powerState: string | null | undefined): {
  state: "online" | "offline" | "warning" | "unknown";
  label: string;
} {
  switch (powerState?.trim().toLowerCase()) {
    case "running":
      return { state: "online", label: "运行中" };
    case "stopped":
      return { state: "offline", label: "已关机" };
    case "paused":
      return { state: "warning", label: "已暂停" };
    case "suspended":
      return { state: "warning", label: "已挂起" };
    default:
      return { state: "unknown", label: "电源状态未知" };
  }
}

export function VirtualMachinePowerLabel({ powerState, compact = false }: { powerState: string | null | undefined; compact?: boolean }) {
  const status = virtualMachinePowerState(powerState);
  return (
    <span className={`workspace-status-label workspace-status-label--${status.state} ${compact ? "is-compact" : ""}`} title={`虚拟机电源：${status.label}`}>
      <StatusDot state={status.state} />
      {!compact && status.label}
    </span>
  );
}

export function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Layer as="section" className={`workspace-surface ${className}`}>{children}</Layer>;
}
export function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}
