import React from "react";

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
  | "chevronUp";

const iconPaths: Record<IconName, string[]> = {
  overview: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  hub: ["M4 9h16", "M6 9V6l6-3 6 3v3", "M6 9v9", "M12 9v9", "M18 9v9", "M4 18h16"],
  device: ["M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 20h8", "M12 18v2"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-2.4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H6v-2.4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L7.3 8.6 9 6.9l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.1h2.4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1V14h-.1a1.7 1.7 0 0 0-1.6 1z"],
  back: ["M19 12H5", "M11 18l-6-6 6-6"],
  search: ["M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z", "m21 21-4.4-4.4"],
  refresh: ["M20 11a8.1 8.1 0 0 0-14.7-3L3 11", "M3 5v6h6", "M4 13a8.1 8.1 0 0 0 14.7 3L21 13", "M21 19v-6h-6"],
  collapse: ["M9 6 3 12l6 6", "M15 6l6 6-6 6"],
  chevron: ["m6 9 6 6 6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"],
  copy: ["M8 8h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h0"],
  warning: ["M12 4 21 20H3L12 4z", "M12 10v4", "M12 17h.01"],
  check: ["m5 12 4 4L19 6"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  agent: ["M7 7h10v10H7z", "M4 10h3", "M17 10h3", "M10 4v3", "M14 4v3", "M10 17v3", "M14 17v3"],
  appearance: ["M12 3v18", "M3 12h18", "M5.6 5.6l12.8 12.8", "M18.4 5.6 5.6 18.4"],
  connection: ["M8 12h8", "M6 8h-1a4 4 0 0 0 0 8h1", "M18 8h1a4 4 0 0 1 0 8h-1", "M8 8a4 4 0 0 1 8 0v8a4 4 0 0 1-8 0V8z"],
  data: ["M4 5h16v14H4z", "M8 9h8", "M8 13h5", "M8 16h3"],
  keyboard: ["M4 6h16v12H4z", "M7 10h.01", "M10 10h.01", "M13 10h.01", "M16 10h.01", "M7 14h10"],
  about: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 10v6", "M12 7h.01"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  windowMinimize: ["M5 19h14"],
  windowMaximize: ["M5 5h14v14H5z"],
  windowRestore: ["M8 8h11v11H8z", "M5 16V5h11"],
  windowClose: ["m6 6 12 12", "m18 6L6 18"]
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg className="workspace-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {iconPaths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  );
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
  return (
    <button className={`workspace-button workspace-button--${variant} ${className}`} autoFocus={autoFocus} disabled={disabled} onClick={onClick} type={type} title={title}>
      {children}
    </button>
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
  return <section className={`workspace-surface ${className}`}>{children}</section>;
}
export function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}
