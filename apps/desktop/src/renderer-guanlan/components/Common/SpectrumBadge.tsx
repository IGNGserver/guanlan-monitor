import React from "react";

export type BadgeStatus = "online" | "offline" | "warning" | "error" | "cached";

interface SpectrumBadgeProps {
  status: BadgeStatus;
  label: string;
  className?: string;
}

export const SpectrumBadge: React.FC<SpectrumBadgeProps> = ({ status, label, className = "" }) => {
  return (
    <span className={`gl-badge gl-badge-${status} ${className}`}>
      <span className={`gl-status-dot ${status}`} />
      {label}
    </span>
  );
};
