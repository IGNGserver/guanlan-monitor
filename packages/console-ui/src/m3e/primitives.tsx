import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

/* =============================================================================
 * Material 3 Expressive component primitives.
 *
 * Native React + CSS only. No external headless library. Each control
 * carries the same prop surface the workspace already used, so pages are rewritten
 * against behaviour, not against a vendor API.
 * ========================================================================== */

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/* ---- Ripple / state-layer host -------------------------------------------- */

interface RippleDrop {
  id: number;
  x: number;
  y: number;
  size: number;
}

export function useRipple<T extends HTMLElement>() {
  const [ripples, setRipples] = useState<RippleDrop[]>([]);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((timer) => window.clearTimeout(timer)); }, []);
  const onPointerDown = useCallback((event: React.PointerEvent<T>) => {
    const host = event.currentTarget;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const id = ++counter.current;
    setRipples((current) => [...current, { id, x: event.clientX - rect.left, y: event.clientY - rect.top, size }]);
    const timer = window.setTimeout(() => setRipples((current) => current.filter((drop) => drop.id !== id)), 520);
    timers.current.push(timer);
  }, []);
  const rippleNodes = ripples.map((drop) => (
    <span
      key={drop.id}
      className="m3e-ripple"
      style={{ left: drop.x - drop.size / 2, top: drop.y - drop.size / 2, width: drop.size, height: drop.size }}
      aria-hidden="true"
    />
  ));
  return { onPointerDown, rippleNodes };
}

/* ---- Button ---------------------------------------------------------------- */

export type M3ButtonVariant = "filled" | "tonal" | "elevated" | "outlined" | "text" | "danger";
export type M3ButtonSize = "sm" | "md" | "lg";

export interface M3ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: M3ButtonVariant;
  size?: M3ButtonSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export function M3Button({
  children,
  className,
  variant = "filled",
  size = "md",
  leadingIcon,
  trailingIcon,
  type = "button",
  disabled,
  ...props
}: M3ButtonProps) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <button
      className={joinClasses("m3e-button", `m3e-button--${variant}`, `m3e-button--${size}`, "m3e-state-host", className)}
      type={type}
      disabled={disabled}
      onPointerDown={disabled ? undefined : onPointerDown}
      {...props}
    >
      {leadingIcon ? <span className="m3e-button__icon" aria-hidden="true">{leadingIcon}</span> : null}
      <span className="m3e-button__label">{children}</span>
      {trailingIcon ? <span className="m3e-button__icon" aria-hidden="true">{trailingIcon}</span> : null}
      {rippleNodes}
    </button>
  );
}

/* ---- FAB ------------------------------------------------------------------- */

export interface M3FabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  extended?: boolean;
  variant?: "primary" | "secondary" | "tertiary" | "surface";
}

export function M3Fab({ icon, extended = false, variant = "primary", children, className, type = "button", ...props }: M3FabProps) {
  return (
    <button
      className={joinClasses("m3e-fab", `m3e-fab--${variant}`, extended ? "m3e-fab--extended" : "m3e-fab--round", "m3e-state-host", className)}
      type={type}
      {...props}
    >
      <span className="m3e-fab__icon" aria-hidden="true">{icon}</span>
      {extended ? <span className="m3e-fab__label">{children}</span> : null}
    </button>
  );
}

/* ---- Icon button ----------------------------------------------------------- */

export interface M3IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-pressed" | "title"> {
  label: string;
  children: React.ReactNode;
  selected?: boolean;
  variant?: "standard" | "tonal" | "filled";
  size?: M3ButtonSize;
}

export function M3IconButton({ label, children, className, selected, variant = "standard", size = "md", type = "button", disabled, ...props }: M3IconButtonProps) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <button
      className={joinClasses("m3e-icon-button", `m3e-icon-button--${variant}`, `m3e-button--${size}`, selected && "is-selected", "m3e-state-host", className)}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={selected}
      disabled={disabled}
      onPointerDown={disabled ? undefined : onPointerDown}
      {...props}
    >
      <span aria-hidden="true">{children}</span>
      {rippleNodes}
    </button>
  );
}

/* ---- Chip / filter chip ---------------------------------------------------- */

export interface M3ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  leadingIcon?: React.ReactNode;
  selected?: boolean;
  variant?: "assist" | "filter" | "input";
}

export function M3Chip({ children, className, leadingIcon, selected, variant = "filter", type = "button", ...props }: M3ChipProps) {
  return (
    <button
      className={joinClasses("m3e-chip", `m3e-chip--${variant}`, selected && "is-selected", "m3e-state-host", className)}
      type={type}
      aria-pressed={variant === "filter" ? selected : undefined}
      {...props}
    >
      {selected && variant === "filter"
        ? <span className="m3e-chip__icon" aria-hidden="true"><Icon name="check" size={18} weight={2.2} /></span>
        : leadingIcon ? <span className="m3e-chip__icon" aria-hidden="true">{leadingIcon}</span> : null}
      <span className="m3e-chip__label">{children}</span>
    </button>
  );
}

/* ---- Navigation item ------------------------------------------------------- */

export interface M3NavigationItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-current"> {
  children: React.ReactNode;
  selected?: boolean;
  icon?: React.ReactNode;
}

export function M3NavigationItem({ children, className, selected = false, icon, type = "button", ...props }: M3NavigationItemProps) {
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <button
      className={joinClasses("m3e-nav-item", selected && "is-selected", "m3e-state-host", className)}
      type={type}
      aria-current={selected ? "page" : undefined}
      onPointerDown={onPointerDown}
      {...props}
    >
      {icon ? <span className="m3e-nav-item__icon">{icon}</span> : null}
      <span className="m3e-nav-item__label">{children}</span>
      {rippleNodes}
    </button>
  );
}

/* ---- Segmented button ------------------------------------------------------ */

export interface M3SegmentedOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface M3SegmentedControlProps {
  options: M3SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function M3SegmentedControl({ options, value, onChange, className, disabled = false, size = "md", "aria-label": ariaLabel }: M3SegmentedControlProps) {
  return (
    <div className={joinClasses("m3e-segmented", `m3e-segmented--${size}`, disabled && "is-disabled", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            className={joinClasses("m3e-segmented__segment", active && "is-selected", "m3e-state-host")}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled || option.disabled}
            onClick={() => { if (!disabled && !option.disabled) onChange(option.value); }}
          >
            {active ? <span className="m3e-segmented__check" aria-hidden="true"><Icon name="check" size={18} weight={2.2} /></span> : null}
            {option.icon && !active ? <span className="m3e-segmented__icon" aria-hidden="true">{option.icon}</span> : null}
            <span className="m3e-segmented__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---- Switch / checkbox ----------------------------------------------------- */

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
    <div className={joinClasses("m3e-switch-row", compact && "is-compact", disabled && "is-disabled", className)}>
      {!compact && <label className="m3e-switch-row__copy" htmlFor={id}><span className="m3e-switch-row__label">{label}</span>{description ? <span className="m3e-switch-row__description">{description}</span> : null}</label>}
      <button
        id={id}
        className={joinClasses("m3e-switch", "m3e-state-host", checked && "is-on")}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={compact ? label : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="m3e-switch__track" aria-hidden="true"><span className="m3e-switch__thumb" /></span>
      </button>
    </div>
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
  const { onPointerDown, rippleNodes } = useRipple<HTMLButtonElement>();
  return (
    <button
      className={joinClasses("m3e-checkbox", compact && "is-compact", disabled && "is-disabled", "m3e-state-host", className)}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onPointerDown={disabled ? undefined : onPointerDown}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className={joinClasses("m3e-checkbox__box", checked && "is-checked")} aria-hidden="true">
        {checked ? <Icon name="check" size={16} weight={2.4} /> : null}
      </span>
      <span className="m3e-checkbox__copy"><span className="m3e-checkbox__label">{label}</span>{description ? <span className="m3e-checkbox__description">{description}</span> : null}</span>
      {rippleNodes}
    </button>
  );
}

/* ---- Text field ------------------------------------------------------------ */

export interface M3TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  supportingText?: React.ReactNode;
  errorText?: React.ReactNode;
  variant?: "filled" | "outlined";
}

export function M3TextField({ label, supportingText, errorText, id, className, variant = "filled", ...props }: M3TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = Boolean(errorText);
  const describedBy = hasError ? `${inputId}-error` : supportingText ? `${inputId}-support` : undefined;
  return (
    <div className={joinClasses("m3e-field", `m3e-field--${variant}`, hasError && "is-error", props.disabled && "is-disabled", className)}>
      <div className="m3e-field__container">
        <input
          {...props}
          id={inputId}
          className="m3e-field__input"
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          placeholder={props.placeholder ?? " "}
        />
        <label className="m3e-field__label" htmlFor={inputId}>{label}</label>
      </div>
      {(hasError || supportingText) ? (
        <span className="m3e-field__support" id={describedBy}>{hasError ? errorText : supportingText}</span>
      ) : null}
    </div>
  );
}

/* ---- Select ---------------------------------------------------------------- */

export interface M3SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface M3SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  options: M3SelectOption[];
  hideLabel?: boolean;
}

function selectOptionText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return selectOptionText(node.props.children);
  return React.Children.toArray(node).map(selectOptionText).join("");
}

export function M3Select({ label, options, hideLabel = false, id, className, ...props }: M3SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const labelId = `${selectId}-label`;
  const listId = `${selectId}-list`;
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const initialValue = String(props.defaultValue ?? options.find((option) => !option.disabled)?.value ?? "");
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const selectedValue = props.value === undefined ? uncontrolledValue : String(props.value);
  const selected = options.findIndex((option) => option.value === selectedValue);
  const enabled = options.map((option, position) => option.disabled ? -1 : position).filter((position) => position >= 0);
  const typeahead = useRef({ text: "", time: 0 });

  const closeMenu = () => { menu.current?.hidePopover(); setOpen(false); };
  const placeMenu = () => {
    if (!trigger.current || !menu.current) return;
    const bounds = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewLeft = viewport?.offsetLeft ?? 0;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
    const width = Math.min(Math.max(200, bounds.width), viewWidth - 16);
    const below = viewBottom - bounds.bottom - 8;
    const above = bounds.top - viewTop - 8;
    menu.current.style.width = `${width}px`;
    const naturalHeight = menu.current.scrollHeight || options.length * 48 + 16;
    const down = below >= Math.min(256, naturalHeight) || below >= above;
    const maxHeight = Math.min(320, Math.max(48, down ? below : above));
    const height = Math.min(naturalHeight, maxHeight);
    Object.assign(menu.current.style, {
      width: `${width}px`, maxHeight: `${maxHeight}px`,
      left: `${Math.max(viewLeft + 8, Math.min(bounds.left, viewLeft + viewWidth - width - 8))}px`,
      top: `${down ? bounds.bottom + 6 : Math.max(viewTop + 8, bounds.top - height - 6)}px`
    });
  };
  const openMenu = (position = selected >= 0 && !options[selected].disabled ? selected : enabled[0]) => {
    if (props.disabled || !enabled.length) return;
    setActive(position);
    placeMenu();
    menu.current?.showPopover();
    placeMenu();
    setOpen(true);
  };
  const commit = (position: number, restoreFocus = true) => {
    const option = options[position];
    if (!option || option.disabled || !native.current) return;
    // Dispatch a real native select change so existing onChange handlers and
    // form serialization keep the same HTMLSelectElement event contract.
    if (native.current.value !== option.value) {
      native.current.value = option.value;
      native.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeMenu();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    const place = () => placeMenu();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  });
  useEffect(() => {
    if (props.disabled && open) closeMenu();
    if (open) menu.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, props.disabled]);
  useEffect(() => {
    const form = native.current?.form;
    const reset = () => setUncontrolledValue(initialValue);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [initialValue, props.form]);

  return (
    <div className={joinClasses("m3e-select", hideLabel && "is-label-hidden", className)}>
      <label className="m3e-select__label" id={labelId} htmlFor={props.multiple ? selectId : `${selectId}-trigger`}>{label}</label>
      <div className="m3e-select__container">
        <select
          {...props}
          ref={native}
          id={selectId}
          className={props.multiple ? "m3e-select__control" : "m3e-select__native"}
          hidden={!props.multiple}
          aria-hidden={props.multiple ? undefined : true}
          tabIndex={props.multiple ? props.tabIndex : -1}
          autoFocus={props.multiple ? props.autoFocus : false}
          onChange={(event) => { setUncontrolledValue(event.target.value); props.onChange?.(event); }}
          onInvalid={(event) => { if (!props.multiple) { event.preventDefault(); trigger.current?.focus(); } props.onInvalid?.(event); }}
        >
          {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{selectOptionText(option.label)}</option>)}
        </select>
        {!props.multiple && <>
          <button
            ref={trigger}
            id={`${selectId}-trigger`}
            type="button"
            className="m3e-select__control"
            role="combobox"
            aria-label={props["aria-label"]}
            aria-labelledby={props["aria-label"] ? undefined : labelId}
            aria-describedby={props["aria-describedby"]}
            aria-invalid={props["aria-invalid"]}
            aria-required={props.required || undefined}
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            disabled={props.disabled || !enabled.length}
            autoFocus={props.autoFocus}
            tabIndex={props.tabIndex}
            title={props.title}
            onClick={() => open ? closeMenu() : openMenu()}
            onKeyDown={(event) => {
              if (event.key === "Escape") { if (open) { event.preventDefault(); closeMenu(); } return; }
              if (event.key === "Tab") { if (open) commit(active, false); return; }
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                if (event.key === "Home" || event.key === "End") {
                  const next = event.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
                  if (open) setActive(next); else openMenu(next);
                } else if (!open) openMenu();
                else {
                  const current = enabled.indexOf(active);
                  setActive(enabled[Math.max(0, Math.min(enabled.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))]);
                }
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (open) commit(active); else openMenu();
                return;
              }
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                const now = performance.now();
                typeahead.current.text = (now - typeahead.current.time > 700 ? "" : typeahead.current.text) + event.key.toLocaleLowerCase();
                typeahead.current.time = now;
                const next = enabled.find((position) => selectOptionText(options[position].label).toLocaleLowerCase().startsWith(typeahead.current.text));
                if (next != null) { if (open) setActive(next); else openMenu(next); }
              }
            }}
          >
            <span className="m3e-select__value">{options[selected]?.label ?? "请选择"}</span>
            <span className="m3e-select__chevron" aria-hidden="true"><Icon name="chevron" size={20} /></span>
          </button>
          <div ref={menu} id={listId} className="m3e-select__menu" popover="auto" role="listbox" aria-labelledby={labelId} onToggle={(event) => setOpen((event.nativeEvent as ToggleEvent).newState === "open")}>
            {options.map((option, position) => <div
              key={option.value}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={option.value === selectedValue}
              aria-disabled={option.disabled || undefined}
              data-option-index={position}
              className={joinClasses("m3e-select__option", active === position && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(position)}
              onPointerMove={(event) => { if (event.pointerType === "mouse" && !option.disabled) setActive(position); }}
            ><span>{option.label}</span>{option.value === selectedValue && <Icon name="check" size={18} />}</div>)}
          </div>
        </>}
      </div>
    </div>
  );
}

/* ---- Search bar ------------------------------------------------------------ */

export interface M3SearchBarProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  onClear?: () => void;
}

export function M3SearchBar({ label, onClear, id, className, value, ...props }: M3SearchBarProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={joinClasses("m3e-search-bar", className)}>
      <span className="m3e-search-bar__icon" aria-hidden="true"><Icon name="search" size={20} /></span>
      <input {...props} id={inputId} className="m3e-search-bar__input" aria-label={label} value={value} />
      {onClear && value ? (
        <button className="m3e-search-bar__clear m3e-state-host" type="button" aria-label="清除" onClick={onClear}>
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/* ---- Tabs ------------------------------------------------------------------ */

export interface M3TabItem {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface M3TabsProps {
  tabs: M3TabItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
  className?: string;
}

export function M3Tabs({ tabs, value, onChange, className, "aria-label": ariaLabel }: M3TabsProps) {
  return (
    <div className={joinClasses("m3e-tabs", className)} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={joinClasses("m3e-tabs__tab", "m3e-state-host", tab.id === value && "is-selected")}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
        >
          <span className="m3e-tabs__label">{tab.label}</span>
          <span className="m3e-tabs__indicator" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/* ---- Card ------------------------------------------------------------------ */

export interface M3CardProps extends React.HTMLAttributes<HTMLElement> {
  variant?: "filled" | "elevated" | "outlined";
  as?: "div" | "section" | "article" | "li";
}

export function M3Card({ variant = "filled", as: Tag = "div", className, children, ...props }: M3CardProps) {
  return <Tag className={joinClasses("m3e-card", `m3e-card--${variant}`, className)} {...props}>{children}</Tag>;
}

/* ---- List ------------------------------------------------------------------ */

export function M3List({ className, children, ...props }: React.HTMLAttributes<HTMLUListElement>) {
  return <ul className={joinClasses("m3e-list", className)} {...props}>{children}</ul>;
}

export interface M3ListItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function M3ListItem({ leading, trailing, className, children, ...props }: M3ListItemProps) {
  return (
    <li className={joinClasses("m3e-list-item", className)} {...props}>
      {leading ? <span className="m3e-list-item__leading">{leading}</span> : null}
      <span className="m3e-list-item__body">{children}</span>
      {trailing ? <span className="m3e-list-item__trailing">{trailing}</span> : null}
    </li>
  );
}

/* ---- Progress -------------------------------------------------------------- */

export function M3LinearProgress({ className, label }: { className?: string; label?: string }) {
  return <div className={joinClasses("m3e-linear-progress", className)} role="progressbar" aria-label={label} aria-valuetext={label} />;
}

/* ---- Badge ----------------------------------------------------------------- */

export function M3Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "primary" | "success" | "warning" | "error" | "info"; className?: string }) {
  return <span className={joinClasses("m3e-badge", `m3e-badge--${tone}`, className)}>{children}</span>;
}

/* ---- Dialog ---------------------------------------------------------------- */

export interface M3DialogProps {
  open: boolean;
  onClose: () => void;
  headline: string;
  icon?: IconName;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  danger?: boolean;
  className?: string;
  /** Accessible name for the dialog; defaults to the headline. */
  "aria-label"?: string;
}

export function M3Dialog({ open, onClose, headline, icon, children, actions, danger = false, className, "aria-label": ariaLabel }: M3DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const target = containerRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        ?? containerRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea");
      target?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="m3e-scrim">
      <div
        ref={containerRef}
        className={joinClasses("m3e-dialog", danger && "m3e-dialog--danger", className)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? headline}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m3e-dialog__headline">
          {icon ? <span className={joinClasses("m3e-dialog__icon", danger && "is-danger")} aria-hidden="true"><Icon name={icon} size={24} /></span> : null}
          <h2 className="m3e-dialog__title">{headline}</h2>
        </div>
        {children ? <div className="m3e-dialog__content">{children}</div> : null}
        {actions ? <div className="m3e-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/* ---- Inline banner --------------------------------------------------------- */

export function M3Banner({
  tone = "info",
  title,
  children,
  action,
  className
}: {
  tone?: "info" | "success" | "warning" | "error";
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClasses("m3e-banner", `m3e-banner--${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      <span className="m3e-banner__icon" aria-hidden="true">
        <Icon name={tone === "error" ? "error" : tone === "success" ? "check" : tone === "warning" ? "warning" : "info"} size={22} />
      </span>
      <div className="m3e-banner__body">
        <strong className="m3e-banner__title">{title}</strong>
        {children ? <div className="m3e-banner__text">{children}</div> : null}
      </div>
      {action ? <div className="m3e-banner__action">{action}</div> : null}
    </section>
  );
}

/* ---- Snackbar -------------------------------------------------------------- */

export function M3Snackbar({ tone = "info", children, className }: { tone?: "info" | "success" | "error"; children: React.ReactNode; className?: string }) {
  return (
    <div className={joinClasses("m3e-snackbar", `m3e-snackbar--${tone}`, className)} role={tone === "error" ? "alert" : "status"}>
      <span className="m3e-snackbar__text">{children}</span>
    </div>
  );
}

/* ---- Data table ------------------------------------------------------------ */

export interface M3DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "start" | "end";
  /** Hidden below the given viewport width, in px. */
  hideBelow?: number;
}

export interface M3DataTableProps<T> {
  rows: T[];
  columns: M3DataTableColumn<T>[];
  rowKey: (row: T) => string;
  "aria-label": string;
  onRowClick?: (row: T) => void;
  onRowActivate?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyState?: React.ReactNode;
  className?: string;
}

export function M3DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  onRowActivate,
  rowClassName,
  emptyState,
  className,
  "aria-label": ariaLabel
}: M3DataTableProps<T>) {
  if (!rows.length) return <>{emptyState ?? null}</>;
  const interactive = Boolean(onRowClick || onRowActivate);
  return (
    <div className={joinClasses("m3e-table-wrap", className)}>
      <table className="m3e-table" aria-label={ariaLabel}>
        <thead>
          <tr>{columns.map((column) => (
            <th key={column.key} scope="col" data-align={column.align} style={column.hideBelow ? { ["--m3e-hide-below" as string]: String(column.hideBelow) } : undefined}>{column.header}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={rowClassName?.(row)}
              tabIndex={interactive ? 0 : undefined}
              onClick={onRowClick ? (event) => {
                if (event.target instanceof Element && event.target.closest("button, a, [role=menuitem], input, select")) return;
                onRowClick(row);
              } : undefined}
              onKeyDown={(event) => {
                if (!onRowActivate) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                if (event.target instanceof Element && event.target.closest("button, a, [role=menuitem]")) return;
                event.preventDefault();
                onRowActivate(row);
              }}
            >
              {columns.map((column) => (
                <td key={column.key} data-align={column.align} style={column.hideBelow ? { ["--m3e-hide-below" as string]: String(column.hideBelow) } : undefined}>{column.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
