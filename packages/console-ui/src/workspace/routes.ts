/**
 * The canonical settings sections are identical on every client: the same id
 * always means the same page, so a user who learned the desktop settings can
 * find their way around the browser console without re-learning names.
 *
 * `workspace` and `session` were browser-only section ids and `connections` was
 * desktop-only. They stay parseable as aliases (see `legacySettingsSections`)
 * because bookmarks and chat screenshots still carry the old hashes.
 */
export type SettingsSection =
  | "general"
  | "appearance"
  | "connections"
  | "agent"
  | "data"
  | "shortcuts"
  | "about";

export type WorkspaceRoute =
  | { kind: "overview" }
  | { kind: "devices" }
  | { kind: "device"; deviceId: string }
  | { kind: "settings"; section: SettingsSection };

export const defaultRoute: WorkspaceRoute = { kind: "overview" };

const settingsSections = new Set<SettingsSection>([
  "general",
  "appearance",
  "connections",
  "agent",
  "data",
  "shortcuts",
  "about"
]);

/** Retired section ids mapped onto the section that replaced them. */
const legacySettingsSections: Record<string, SettingsSection> = {
  workspace: "general",
  session: "connections"
};

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
export function parseWorkspaceHash(hash: string): WorkspaceRoute {
  const value = hash.replace(/^#/, "").replace(/^\//, "");
  if (value === "devices") return { kind: "devices" };
  const [kind, rawId] = value.split("/");
  const id = rawId ? decodeSegment(rawId) : null;
  if (kind === "device" && id) return { kind: "device", deviceId: id };
  // The standalone hub page was folded into the overview: the connection facts
  // it used to own are now a card there, and its settings live under 连接.
  if (kind === "hub") return defaultRoute;
  if (kind === "settings") {
    if (id && settingsSections.has(id as SettingsSection)) return { kind: "settings", section: id as SettingsSection };
    // A retired id still opens the page that absorbed it instead of bouncing the
    // user back to the overview with no explanation.
    if (id && legacySettingsSections[id]) return { kind: "settings", section: legacySettingsSections[id] };
    // `#settings` without a section is the entry point the sidebar footer uses.
    if (!id) return { kind: "settings", section: "general" };
  }
  return defaultRoute;
}

export function routeFromLocation(): WorkspaceRoute {
  if (typeof window === "undefined") return defaultRoute;
  return parseWorkspaceHash(window.location.hash);
}

export function serializeWorkspaceRoute(route: WorkspaceRoute): string {
  switch (route.kind) {
    case "devices":
      return "#devices";
    case "device":
      return `#device/${encodeURIComponent(route.deviceId)}`;
    case "settings":
      return `#settings/${route.section}`;
    default:
      return "#overview";
  }
}
