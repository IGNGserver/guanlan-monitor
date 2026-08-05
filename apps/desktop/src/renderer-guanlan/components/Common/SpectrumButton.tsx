import React from "react";

interface SpectrumButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "sm";
  children: React.ReactNode;
}

export const SpectrumButton: React.FC<SpectrumButtonProps> = ({
  variant = "secondary",
  size = "md",
  children,
  className = "",
  disabled,
  ...props
}) => {
  const sizeClass = size === "sm" ? "gl-button-sm" : "";
  return (
    <button
      className={`gl-button gl-button-${variant} ${sizeClass} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
