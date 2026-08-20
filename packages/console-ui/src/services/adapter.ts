import type {
  DesktopAgentBackendState,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";

export interface ConsoleCapabilities {
  canManageLocalAgent: boolean;
  canUseOfflineCache: boolean;
  canChangeStartupSettings: boolean;
  canControlNativeWindow: boolean;
  canUseWindowMaterial: boolean;
  canConfigureConnection: boolean;
  requiresAuthentication: boolean;
}

export interface ConsoleAdapter {
  readonly capabilities: ConsoleCapabilities;
  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
  login(accessKey: string): Promise<DesktopSnapshot>;
  logout(): Promise<DesktopSnapshot>;
  disconnectAgent(): Promise<DesktopSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot>;
  deleteInstance(deviceId: string): Promise<DesktopSnapshot>;
  reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot>;
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync>;
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync>;
  openExternal(url: string): Promise<void>;
  updateLocalConfig?(patch: DesktopConfigPatch): Promise<DesktopSnapshot>;
  controlAgent?(action: DesktopAgentControlAction): Promise<DesktopSnapshot>;
  updateStartupSettings?(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot>;
  cloudPush?(): Promise<DesktopSnapshot>;
  getLocalBackend?(): Promise<DesktopAgentBackendState | null>;
  windowMinimize?(): Promise<void>;
  windowToggleMaximize?(): Promise<boolean>;
  windowClose?(): Promise<void>;
  windowDragStart?(screenX: number, screenY: number): void;
  windowDragMove?(screenX: number, screenY: number): void;
  windowDragEnd?(): void;
  getWindowMaterialCapabilities?(): Promise<WindowMaterialCapabilities>;
  setWindowMaterial?(material: WindowMaterial): Promise<WindowMaterialCapabilities>;
}

export type WindowMaterial = "guanlan" | "mica" | "acrylic";

export interface WindowMaterialCapabilities {
  platform: "windows" | "other";
  windowsBuild: number | null;
  supportsMica: boolean;
  supportsAcrylic: boolean;
  prefersReducedTransparency: boolean;
  activeMaterial: WindowMaterial;
}

export const WEB_CAPABILITIES: ConsoleCapabilities = {
  canManageLocalAgent: false,
  canUseOfflineCache: false,
  canChangeStartupSettings: false,
  canControlNativeWindow: false,
  canUseWindowMaterial: false,
  canConfigureConnection: false,
  requiresAuthentication: true
};

export const DESKTOP_CAPABILITIES: ConsoleCapabilities = {
  canManageLocalAgent: true,
  canUseOfflineCache: true,
  canChangeStartupSettings: true,
  canControlNativeWindow: true,
  canUseWindowMaterial: true,
  canConfigureConnection: true,
  requiresAuthentication: false
};

export function fallbackWindowMaterialCapabilities(): WindowMaterialCapabilities {
  return {
    platform: "other",
    windowsBuild: null,
    supportsMica: false,
    supportsAcrylic: false,
    prefersReducedTransparency: false,
    activeMaterial: "guanlan"
  };
}

export function emptyConsoleSnapshot(): DesktopSnapshot {
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
