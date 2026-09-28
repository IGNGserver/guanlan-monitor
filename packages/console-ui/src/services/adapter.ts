import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopStartupSettings,
  DesktopRuntimeProfile,
  ConsoleSnapshot
} from "@dsc/shared";
import type { ConsoleFleetPort, ConsoleReadPort, ConsoleSessionPort } from "./ports.ts";

export interface ConsoleCapabilities {
  canManageLocalAgent: boolean;
  canUseOfflineCache: boolean;
  canChangeStartupSettings: boolean;
  canControlNativeWindow: boolean;
  canConfigureConnection: boolean;
  requiresAuthentication: boolean;
  /**
   * How a live snapshot reaches this client.
   *
   * `push` is a realtime channel (the browser console subscribes to
   * `device:update` over socket.io); `poll` is a visibility-aware timer (the
   * Electron shell refreshes through the host bridge). Both are "live" data, but
   * "实时" is a claim about refresh latency that only the push client can make,
   * so every data-link label is derived from this value instead of guessing from
   * the source alone.
   */
  liveDataTransport: "push" | "poll";
}

export interface ConsoleAdapter extends ConsoleReadPort, ConsoleSessionPort, ConsoleFleetPort {
  readonly capabilities: ConsoleCapabilities;
  updateLocalConfig?(patch: DesktopConfigPatch): Promise<ConsoleSnapshot>;
  controlAgent?(action: DesktopAgentControlAction): Promise<ConsoleSnapshot>;
  updateStartupSettings?(settings: Partial<DesktopStartupSettings>): Promise<ConsoleSnapshot>;
  cloudPush?(): Promise<ConsoleSnapshot>;
  windowMinimize?(): Promise<void>;
  windowToggleMaximize?(): Promise<boolean>;
  windowClose?(): Promise<void>;
  windowDragStart?(screenX: number, screenY: number): void;
  windowDragMove?(screenX: number, screenY: number): void;
  windowDragEnd?(): void;
  getWindowMaterialCapabilities?(): Promise<WindowMaterialCapabilities>;
  getRuntimeProfile?(): Promise<DesktopRuntimeProfile>;
}

export type WindowMaterial = "opaque" | "mica";

export interface WindowMaterialCapabilities {
  platform: "windows" | "other";
  windowsBuild: number | null;
  supportsMica: boolean;
  prefersReducedTransparency: boolean;
  activeMaterial: WindowMaterial;
}

export const WEB_CAPABILITIES: ConsoleCapabilities = {
  canManageLocalAgent: false,
  canUseOfflineCache: false,
  canChangeStartupSettings: false,
  canControlNativeWindow: false,
  canConfigureConnection: false,
  requiresAuthentication: true,
  liveDataTransport: "push"
};

export const DESKTOP_CAPABILITIES: ConsoleCapabilities = {
  canManageLocalAgent: true,
  canUseOfflineCache: true,
  canChangeStartupSettings: true,
  canControlNativeWindow: true,
  canConfigureConnection: true,
  requiresAuthentication: false,
  liveDataTransport: "poll"
};

export function fallbackWindowMaterialCapabilities(): WindowMaterialCapabilities {
  return {
    platform: "other",
    windowsBuild: null,
    supportsMica: false,
    prefersReducedTransparency: false,
    activeMaterial: "opaque"
  };
}

export function fallbackRuntimeProfile(): DesktopRuntimeProfile {
  return {
    isRemoteSession: false,
    memoryPressure: "normal",
    recommendedRefreshInterval: 5,
    chartPointLimit: 240,
    useOpaqueWindow: false
  };
}

export function emptyConsoleSnapshot(): ConsoleSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    source: "empty",
    cache: { available: false, savedAt: null, ageSeconds: null },
    session: { authenticated: false, accessKeyConfigured: false },
    localBackend: null,
    devices: [],
    selectedDeviceId: null,
    metrics: null,
    overviewMetrics: null,
    trafficCalendar: null,
    update: null,
    startup: { openAtLogin: false, startMinimized: false }
  };
}

/** Compatibility alias while downstream integrations migrate to ConsoleAdapter. */
export type IGuanlanDataAdapter = ConsoleAdapter;
