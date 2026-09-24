export type SettingsSection =
  | "general"
  | "workspace"
  | "appearance"
  | "connections"
  | "agent"
  | "data"
  | "shortcuts"
  | "session"
  | "about";

export type WorkspaceRoute =
  | { kind: "overview" }
  | { kind: "devices" }
  | { kind: "hub"; hubId: string }
  | { kind: "device"; deviceId: string }
  | { kind: "settings"; section: SettingsSection };

export const defaultRoute: WorkspaceRoute = { kind: "overview" };

const settingsSections = new Set<SettingsSection>([
  "general",
  "workspace",
  "appearance",
  "connections",
  "agent",
  "data",
  "shortcuts",
  "session",
  "about"
]);

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
  if (kind === "hub" && id) return { kind: "hub", hubId: id };
  if (kind === "settings" && id && settingsSections.has(id as SettingsSection)) {
    return { kind: "settings", section: id as SettingsSection };
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
    case "hub":
      return `#hub/${encodeURIComponent(route.hubId)}`;
    case "settings":
      return `#settings/${route.section}`;
    default:
      return "#overview";
  }
}
