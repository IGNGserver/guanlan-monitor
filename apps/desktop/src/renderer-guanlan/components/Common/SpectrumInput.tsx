import React from "react";

interface SpectrumInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  id?: string;
}

export const SpectrumInput: React.FC<SpectrumInputProps> = ({ label, id, className = "", ...props }) => {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, "-")}` : undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: 12, fontWeight: 500, color: "var(--gl-text-secondary)" }}>
          {label}
        </label>
      )}
      <input id={inputId} className={`gl-input-text ${className}`} {...props} />
    </div>
  );
};

interface SpectrumToggleProps {
  label?: string;
  "aria-label"?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export const SpectrumToggle: React.FC<SpectrumToggleProps> = ({
  label,
  "aria-label": ariaLabel,
  checked,
  onChange,
  disabled,
  id
}) => {
  const toggleId = id || (label ? `toggle-${label.replace(/\s+/g, "-")}` : undefined);
  const effectiveAriaLabel = ariaLabel || label || "切换开关";

  return (
    <label
      htmlFor={toggleId}
      className="gl-toggle-container"
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      <span className="gl-toggle-wrapper" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <input
          id={toggleId}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-label={effectiveAriaLabel}
          aria-checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="gl-toggle-checkbox"
        />
        <div className="gl-toggle" data-checked={checked} aria-hidden="true">
          <div className="gl-toggle-thumb" />
        </div>
      </span>
      {label && label.length > 0 && (
        <span style={{ fontSize: 13, color: "var(--gl-text-primary)" }}>{label}</span>
      )}
    </label>
  );
};
