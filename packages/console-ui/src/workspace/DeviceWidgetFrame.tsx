import React from "react";

export type DeviceWidgetKind = "cpu" | "disk" | "gpu" | "network" | "fan" | "generic";

export function DeviceWidgetFrame({
  kind = "generic",
  eyebrow = "设备实例",
  title,
  subtitle,
  count,
  contentClassName,
  children
}: {
  kind?: DeviceWidgetKind;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  count?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`workspace-device-block workspace-device-block--${kind}`}>
      <header className="workspace-device-block__header">
        <div className="workspace-device-block__identity">
          <span className="workspace-device-block__eyebrow">{eyebrow}</span>
          <h4>{title}</h4>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="workspace-device-block__meta">
          {count && <span className="workspace-device-block__count">{count}</span>}
          <span className="workspace-device-block__marker" aria-hidden="true" />
        </div>
      </header>
      <div className={`workspace-device-block__charts${contentClassName ? ` ${contentClassName}` : ""}`}>
        {children}
      </div>
    </article>
  );
}
