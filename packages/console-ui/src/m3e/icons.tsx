import React from "react";

/**
 * Material 3 icon set.
 *
 * Inline SVG on a 24×24 grid, stroked with `currentColor`, so there is no icon
 * font, no `@carbon/react/icons`, and no external asset. Callers pick a name from
 * `IconName`; every glyph inherits colour, size and stroke from the caller.
 *
 * These approximate Material Symbols (Outlined). They are deliberately geometric
 * and even-weight to match M3E, not Carbon's 32px grid icons.
 */
export type IconName =
  | "overview"
  | "hub"
  | "device"
  | "settings"
  | "back"
  | "arrow"
  | "search"
  | "refresh"
  | "collapse"
  | "chevron"
  | "chevronUp"
  | "chevronRight"
  | "chevronLeft"
  | "external"
  | "copy"
  | "warning"
  | "check"
  | "clock"
  | "agent"
  | "appearance"
  | "connection"
  | "data"
  | "keyboard"
  | "about"
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  | "windowClose"
  | "more"
  | "delete"
  | "menu"
  | "close"
  | "add"
  | "edit"
  | "filter"
  | "sort"
  | "play"
  | "stop"
  | "fullscreen"
  | "fullscreenExit"
  | "sun"
  | "moon"
  | "tune"
  | "list"
  | "grid"
  | "info"
  | "error"
  | "logout"
  | "download"
  | "upload";

const ICONS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  hub: <path d="M7 18.5a4.2 4.2 0 0 1-.5-8.37 5.6 5.6 0 0 1 10.8-1.1A4.5 4.5 0 0 1 17.4 18.5H7Z" />,
  device: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  back: <path d="M19 12H5M11.5 18.5 5 12l6.5-6.5" />,
  arrow: <path d="M5 12h14M12.5 5.5 19 12l-6.5 6.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.75" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  refresh: <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3.5v5h-5" />,
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.4" />
      <path d="M9.5 4v16" />
    </>
  ),
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronUp: <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />,
  chevronRight: <path d="m9.5 6 5.5 6-5.5 6" />,
  chevronLeft: <path d="m14.5 6-5.5 6 5.5 6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4M12 17.2v.3" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="7.5" width="16" height="12.5" rx="3" />
      <circle cx="9" cy="13.5" r="1.3" />
      <circle cx="15" cy="13.5" r="1.3" />
      <path d="M12 7.5V4.5M9 4.5h6" />
    </>
  ),
  appearance: (
    <>
      <path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.15 0 1.9-.9 1.9-1.85 0-.5-.2-.94-.5-1.25-.3-.3-.5-.72-.5-1.2A1.6 1.6 0 0 1 14.5 15H16a4.8 4.8 0 0 0 4.8-4.8c0-3.9-4-7-8.8-7Z" />
      <circle cx="7.6" cy="12.2" r="1" />
      <circle cx="10" cy="8.4" r="1" />
      <circle cx="14" cy="8.4" r="1" />
      <circle cx="16.4" cy="11.4" r="1" />
    </>
  ),
  connection: (
    <>
      <path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l2.1-2.1a4.5 4.5 0 1 0-6.4-6.4L11 5.9" />
      <path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-2.1 2.1a4.5 4.5 0 1 0 6.4 6.4L13 18.1" />
    </>
  ),
  data: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h12" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5.2M12 7.8v.3" />
    </>
  ),
  windowMinimize: <path d="M4.5 12h15" />,
  windowMaximize: <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />,
  windowRestore: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5h9" />
    </>
  ),
  windowClose: <path d="M6 6 18 18M18 6 6 18" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </>
  ),
  delete: <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6 18 18M18 6 6 18" />,
  add: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" />,
  filter: <path d="M3.5 5.5h17l-6.5 7.5V19l-4 2v-8L3.5 5.5Z" />,
  sort: <path d="M7 4v16M7 20l-3-3M17 20V4M17 4l3 3" />,
  play: <path d="M8 5.5 18.5 12 8 18.5v-13Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  fullscreen: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
  fullscreenExit: <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </>
  ),
  moon: <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.8 6.8 0 0 0 9.5 9.5Z" />,
  tune: <path d="M4 7h10M18 7h2M4 17h6M14 17h6M16 4.5v5M10 14.5v5" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5M12 7.8v.3" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7.5V13M12 16.2v.3" />
    </>
  ),
  logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h11" />,
  download: <path d="M12 3.5v11M7.5 10 12 14.5 16.5 10M4.5 19.5h15" />,
  upload: <path d="M12 20.5v-11M7.5 14 12 9.5 16.5 14M4.5 4.5h15" />
};

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Pixel box. M3 glyphs are drawn on 24; size only scales. */
  size?: number;
  /** Optical weight of the stroke. 1.8 is the M3E outline default. */
  weight?: number;
}

export function Icon({ name, size = 20, weight = 1.8, className, ...props }: IconProps) {
  return (
    <svg
      className={className ? `m3e-icon ${className}` : "m3e-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {ICONS[name]}
    </svg>
  );
}
