import React, { useId } from "react";
import {
  Button as CarbonButton,
  Checkbox,
  ContentSwitcher,
  IconButton as CarbonIconButton,
  Layer,
  Select,
  SelectItem,
  Switch as CarbonSwitch,
  Tab,
  TabList,
  Tabs,
  TextInput,
  Toggle
} from "@carbon/react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type M3ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "danger";

export interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: M3ButtonVariant;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

function buttonKind(variant: M3ButtonVariant): "primary" | "secondary" | "danger" | "ghost" | "tertiary" {
  switch (variant) {
    case "tonal":
      return "secondary";
    case "outlined":
      return "tertiary";
    case "text":
      return "ghost";
    case "danger":
      return "danger";
    default:
      return "primary";
  }
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
    <CarbonButton className={joinClasses("m3-button", `m3-button--${variant}`, className)} kind={buttonKind(variant)} type={type} {...props}>
      {leadingIcon && <span className="m3-button__icon" aria-hidden="true">{leadingIcon}</span>}
      <span className="m3-button__label">{children}</span>
      {trailingIcon && <span className="m3-button__icon" aria-hidden="true">{trailingIcon}</span>}
    </CarbonButton>
  );
}

export interface M3IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-pressed" | "title"> {
  label: string;
  children: React.ReactNode;
  selected?: boolean;
  variant?: "standard" | "tonal" | "filled";
}

export function M3IconButton({ label, children, className, selected, variant = "standard", type = "button", ...props }: M3IconButtonProps) {
  const kind = variant === "filled" ? "primary" : variant === "tonal" ? "secondary" : "ghost";
  return (
    <CarbonIconButton
      className={joinClasses("m3-icon-button", `m3-icon-button--${variant}`, className)}
      kind={kind}
      type={type}
      label={label}
      {...(selected === undefined ? {} : { isSelected: selected })}
      {...props}
    >
      {children}
    </CarbonIconButton>
  );
}

export interface M3NavigationItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-current"> {
  children: React.ReactNode;
  selected?: boolean;
}

export function M3NavigationItem({ children, className, selected = false, type = "button", ...props }: M3NavigationItemProps) {
  return (
    <CarbonButton
      className={joinClasses("m3-navigation-item", selected && "is-selected", className)}
      kind="ghost"
      size="md"
      type={type}
      aria-current={selected ? "page" : undefined}
      {...props}
    >
      {children}
    </CarbonButton>
  );
}

export interface M3ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  leadingIcon?: React.ReactNode;
  selected?: boolean;
}

export function M3Chip({ children, className, leadingIcon, selected, type = "button", ...props }: M3ChipProps) {
  return (
    <CarbonButton
      className={joinClasses("m3-chip", selected && "is-selected", className)}
      kind={selected ? "secondary" : "ghost"}
      size="sm"
      type={type}
      aria-pressed={selected}
      {...props}
    >
      {leadingIcon && <span className="m3-chip__icon" aria-hidden="true">{leadingIcon}</span>}
      <span>{children}</span>
    </CarbonButton>
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
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <ContentSwitcher
      className={joinClasses("m3-segmented-control", className)}
      aria-label={ariaLabel}
      selectedIndex={selectedIndex}
      selectionMode="manual"
      size="sm"
      onChange={({ index }) => {
        if (index == null || options[index]?.disabled || disabled) return;
        onChange(options[index].value);
      }}
    >
      {options.map((option) => (
        <CarbonSwitch
          key={option.value}
          disabled={disabled || option.disabled}
          text={typeof option.label === "string" ? option.label : option.value}
        />
      ))}
    </ContentSwitcher>
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
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div className={joinClasses("m3-tabs", className)}>
      <Tabs
        selectedIndex={selectedIndex}
        onChange={({ selectedIndex: nextIndex }) => {
          if (options[nextIndex]?.disabled || disabled) return;
          onChange(options[nextIndex].value);
        }}
      >
        <TabList aria-label={ariaLabel} activation="manual" size="md">
          {options.map((option) => (
            <Tab key={option.value} disabled={disabled || option.disabled}>{option.label}</Tab>
          ))}
        </TabList>
      </Tabs>
    </div>
  );
}

export interface M3TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "id" | "onClick" | "size" | "value"> {
  label: string;
  supportingText?: React.ReactNode;
  errorText?: React.ReactNode;
  id?: string;
  defaultValue?: string | number;
  value?: string | number;
  onClick?: React.MouseEventHandler<HTMLElement>;
}

export function M3TextField({ label, supportingText, errorText, id, className, defaultValue, value, ...props }: M3TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = Boolean(errorText);
  return (
    <TextInput
      {...props}
      defaultValue={defaultValue}
      value={value}
      id={inputId}
      className={joinClasses("m3-field", className)}
      labelText={label}
      helperText={supportingText}
      invalid={hasError}
      invalidText={errorText}
      size="md"
    />
  );
}

export interface M3SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface M3SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  options: M3SelectOption[];
  hideLabel?: boolean;
  selectClassName?: string;
}

export function M3Select({ label, options, hideLabel = false, selectClassName, id, className, ...props }: M3SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <Select
      {...props}
      id={selectId}
      className={joinClasses("m3-select", className, selectClassName)}
      labelText={label}
      hideLabel={hideLabel}
      size="md"
    >
      {options.map((option) => <SelectItem key={option.value} value={option.value} text={typeof option.label === "string" ? option.label : option.value} disabled={option.disabled} />)}
    </Select>
  );
}

export interface M3CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  description?: React.ReactNode;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  title?: string;
}

export function M3Checkbox({ checked, onCheckedChange, label, description, disabled = false, compact = false, className, title }: M3CheckboxProps) {
  const id = useId();
  return (
    <Checkbox
      id={id}
      className={joinClasses("m3-checkbox", compact && "m3-checkbox--compact", className)}
      checked={checked}
      disabled={disabled}
      labelText={label}
      helperText={description}
      title={title}
      onChange={(_, data) => onCheckedChange(data.checked)}
    />
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
  const id = useId();
  return (
    <div className={joinClasses("m3-switch-row", compact && "m3-switch-row--compact", disabled && "is-disabled", className)}>
      {!compact && <div className="m3-switch-row__copy"><span className="m3-switch-row__label">{label}</span>{description && <span className="m3-switch-row__description">{description}</span>}</div>}
      <Toggle
        id={id}
        className="m3-switch"
        labelText={label}
        hideLabel={compact}
        size={compact ? "sm" : "md"}
        toggled={checked}
        disabled={disabled}
        onToggle={onCheckedChange}
      />
    </div>
  );
}

export interface M3SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div";
}

export function M3Surface({ as = "section", children, className, ...props }: M3SurfaceProps) {
  // Carbon's Layer supplies the surface token while retaining the requested
  // semantic landmark for existing consumers.
  return <Layer as={as} className={joinClasses("m3-surface", className)} {...props}>{children}</Layer>;
}
