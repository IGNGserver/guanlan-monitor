import React from "react";

export type BadgeVariant = "online" | "offline" | "live" | "cache" | "warning" | "error" | "info";

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  showDot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({ variant, children, showDot = true }) => {
  return (
    <span className={`badge badge-${variant}`}>
      {showDot && <span className={`status-dot ${variant === "online" ? "online" : variant === "offline" ? "offline" : variant === "live" ? "live" : variant === "warning" ? "warning" : "error"}`} />}
      {children}
    </span>
  );
};
