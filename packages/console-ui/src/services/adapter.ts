import type {
  DesktopAgentBackendState,
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
}

export interface ConsoleAdapter extends ConsoleReadPort, ConsoleSessionPort, ConsoleFleetPort {
  readonly capabilities: ConsoleCapabilities;
  updateLocalConfig?(patch: DesktopConfigPatch): Promise<ConsoleSnapshot>;
  controlAgent?(action: DesktopAgentControlAction): Promise<ConsoleSnapshot>;
  updateStartupSettings?(settings: Partial<DesktopStartupSettings>): Promise<ConsoleSnapshot>;
  cloudPush?(): Promise<ConsoleSnapshot>;
  getLocalBackend?(): Promise<DesktopAgentBackendState | null>;
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
  requiresAuthentication: true
};

export const DESKTOP_CAPABILITIES: ConsoleCapabilities = {
  canManageLocalAgent: true,
  canUseOfflineCache: true,
  canChangeStartupSettings: true,
  canControlNativeWindow: true,
  canConfigureConnection: true,
  requiresAuthentication: false
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
