import React, { useEffect, useRef, useState } from "react";
import { Icon as M3eIcon, type IconName } from "../m3e/icons";
import { M3Button, type M3ButtonVariant } from "../m3e/primitives";

/**
 * Workspace presentation helpers built on the M3E primitives.
 *
 * `Icon` used to dispatch into two Carbon icon maps plus a caption-glyph table.
 * It is now a thin alias for the M3E icon set, so the whole console draws from
 * one geometric source.
 */

export type { IconName };

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <M3eIcon name={name} size={size} />;
}

function toM3Variant(variant: "primary" | "secondary" | "quiet" | "danger"): M3ButtonVariant {
  if (variant === "primary") return "filled";
  if (variant === "secondary") return "tonal";
  if (variant === "quiet") return "text";
  return "danger";
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
  "aria-label"?: string;
}) {
  return (
    <M3Button
      className={`workspace-button workspace-button--${variant} ${className}`}
      autoFocus={autoFocus}
      disabled={disabled}
      onClick={onClick}
      type={type}
      title={title}
      variant={toM3Variant(variant)}
      {...props}
    >
      {children}
    </M3Button>
  );
}

export function StatusDot({ state }: { state: "online" | "offline" | "cached" | "warning" | "unknown" }) {
  return <span className={`workspace-status-dot workspace-status-dot--${state}`} aria-hidden="true" />;
}

const STATUS_LABELS = { online: "在线", offline: "离线", cached: "缓存", warning: "异常", unknown: "未连接" } as const;

export function StatusLabel({ state, compact = false }: { state: "online" | "offline" | "cached" | "warning" | "unknown"; compact?: boolean }) {
  return (
    <span className={`workspace-status-label workspace-status-label--${state} ${compact ? "is-compact" : ""}`} role={compact ? "img" : undefined} aria-label={compact ? STATUS_LABELS[state] : undefined}>
      <StatusDot state={state} />
      {!compact && STATUS_LABELS[state]}
    </span>
  );
}

export function Surface({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`workspace-surface ${className}`}>{children}</section>;
}

export function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="workspace-summary-row"><span>{label}</span><strong className={tone ? `is-${tone}` : ""}>{value}</strong></div>;
}

/**
 * A copy control that answers back. `navigator.clipboard` is unavailable over
 * plain http and can be refused by the desktop shell, so the outcome is
 * announced next to a stable button name.
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
      <Button variant="quiet" onClick={copy} title={label}><Icon name="copy" size={18} />{label}</Button>
      <span className="workspace-copy__state" role="status" aria-live="polite">{result === "copied" ? "已复制" : result === "failed" ? "复制失败，请手动选中复制" : ""}</span>
    </span>
  );
}
