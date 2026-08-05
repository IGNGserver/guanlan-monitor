import React from "react";

interface SpectrumCardProps {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SpectrumCard: React.FC<SpectrumCardProps> = ({
  title,
  action,
  children,
  className = ""
}) => {
  return (
    <div className={`gl-card ${className}`}>
      {(title || action) && (
        <div className="gl-card-header">
          {title && <div className="gl-card-title">{title}</div>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
