import React, { useId, useRef } from "react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type M3ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "danger";

export interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: M3ButtonVariant;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function M3Button({
  children,
  className,
  variant = "filled",
  leadingIcon,
  trailingIcon,
  type = "button",
  ...props
}: M3ButtonProps) {
  return (
    <button className={joinClasses("m3-button", `m3-button--${variant}`, className)} type={type} {...props}>
      {leadingIcon && <span className="m3-button__icon" aria-hidden="true">{leadingIcon}</span>}
      <span className="m3-button__label">{children}</span>
      {trailingIcon && <span className="m3-button__icon" aria-hidden="true">{trailingIcon}</span>}
    </button>
  );
}

export interface M3IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-pressed" | "title"> {
  label: string;
  children: React.ReactNode;
  selected?: boolean;
  variant?: "standard" | "tonal" | "filled";
}

export function M3IconButton({ label, children, className, selected, variant = "standard", type = "button", ...props }: M3IconButtonProps) {
  return (
    <button
      className={joinClasses("m3-icon-button", `m3-icon-button--${variant}`, selected && "is-selected", className)}
      type={type}
      aria-label={label}
      {...(selected === undefined ? {} : { "aria-pressed": selected })}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}

export interface M3ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  leadingIcon?: React.ReactNode;
  selected?: boolean;
}

export function M3Chip({ children, className, leadingIcon, selected, type = "button", ...props }: M3ChipProps) {
  return (
    <button className={joinClasses("m3-chip", selected && "is-selected", className)} type={type} {...(selected === undefined ? {} : { "aria-pressed": selected })} {...props}>
      {leadingIcon && <span className="m3-chip__icon" aria-hidden="true">{leadingIcon}</span>}
      <span>{children}</span>
    </button>
  );
}

export interface M3SegmentedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface M3SegmentedControlProps {
  options: M3SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

export function M3SegmentedControl({ options, value, onChange, className, disabled = false, "aria-label": ariaLabel }: M3SegmentedControlProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusIndex = selectedIndex >= 0 && !options[selectedIndex].disabled
    ? selectedIndex
    : options.findIndex((option) => !option.disabled);

  const focusOption = (startIndex: number, step: 1 | -1) => {
    if (options.length === 0) return;
    let index = startIndex;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + options.length) % options.length;
      if (!options[index].disabled) {
        buttonRefs.current[index]?.focus();
        onChange(options[index].value);
        return;
      }
      index += step;
    }
  };

  return (
    <div className={joinClasses("m3-segmented-control", className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => { buttonRefs.current[index] = element; }}
            className={joinClasses("m3-segmented-control__option", selected && "is-selected")}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusOption(index + 1, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusOption(index - 1, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusOption(0, 1);
              } else if (event.key === "End") {
                event.preventDefault();
                focusOption(options.length - 1, -1);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface M3TabOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface M3TabsProps {
  options: M3TabOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

export function M3Tabs({ options, value, onChange, className, disabled = false, "aria-label": ariaLabel }: M3TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const focusIndex = selectedIndex >= 0 && !options[selectedIndex].disabled
    ? selectedIndex
    : options.findIndex((option) => !option.disabled);

  const focusTab = (startIndex: number, step: 1 | -1) => {
    if (options.length === 0) return;
    let index = (startIndex + options.length) % options.length;
    for (let count = 0; count < options.length; count += 1) {
      if (!options[index].disabled) {
        tabRefs.current[index]?.focus();
        onChange(options[index].value);
        return;
      }
      index = (index + step + options.length) % options.length;
    }
  };

  return (
    <div className={joinClasses("m3-tabs", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => { tabRefs.current[index] = element; }}
            className={joinClasses("m3-tab", selected && "is-selected")}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                focusTab(index + 1, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusTab(index - 1, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusTab(0, 1);
              } else if (event.key === "End") {
                event.preventDefault();
                focusTab(options.length - 1, -1);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface M3TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  supportingText?: React.ReactNode;
  errorText?: React.ReactNode;
}

export function M3TextField({ label, supportingText, errorText, id, className, ...props }: M3TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const supportingId = `${inputId}-supporting`;
  const hasError = Boolean(errorText);
  const describedBy = [supportingText || errorText ? supportingId : undefined, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;

  return (
    <label className={joinClasses("m3-field", hasError && "has-error", className)} htmlFor={inputId}>
      <span className="m3-field__label">{label}</span>
      <input
        {...props}
        id={inputId}
        className="m3-field__input"
        aria-invalid={hasError ? true : props["aria-invalid"]}
        aria-describedby={describedBy}
      />
      {(supportingText || errorText) && <span id={supportingId} className="m3-field__supporting">{errorText || supportingText}</span>}
    </label>
  );
}

export interface M3SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: React.ReactNode;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function M3Switch({ checked, onCheckedChange, label, description, disabled = false, compact = false, className }: M3SwitchProps) {
  return (
    <div className={joinClasses("m3-switch-row", compact && "m3-switch-row--compact", disabled && "is-disabled", className)}>
      {!compact && <div className="m3-switch-row__copy">
        <span className="m3-switch-row__label">{label}</span>
        {description && <span className="m3-switch-row__description">{description}</span>}
      </div>}
      <button
        type="button"
        className={joinClasses("m3-switch", checked && "is-checked")}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="m3-switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

export interface M3SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div";
}

export function M3Surface({ as = "section", children, className, ...props }: M3SurfaceProps) {
  const Component = as;
  return <Component className={joinClasses("m3-surface", className)} {...props}>{children}</Component>;
}
