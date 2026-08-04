import React from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  icon?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionText,
  onAction,
  icon = "⚡"
}) => {
  return (
    <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "36px", marginBottom: "12px", opacity: 0.8 }}>{icon}</div>
      <h3 style={{ fontSize: "16px", marginBottom: "6px", color: "var(--text-main)" }}>{title}</h3>
      <p style={{ color: "var(--text-secondary)", maxWidth: "420px", margin: "0 auto 16px auto", fontSize: "12px" }}>
        {description}
      </p>
      {actionText && onAction && (
        <button className="btn btn-primary" onClick={onAction}>
          {actionText}
        </button>
      )}
    </div>
  );
};
