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
import type { ConsoleAdapter, WindowMaterial, WindowMaterialCapabilities } from "@dsc/console-ui";
import { DESKTOP_CAPABILITIES, emptyConsoleSnapshot, fallbackWindowMaterialCapabilities } from "@dsc/console-ui";
import { dscBridge } from "./dscBridge";

export class DesktopConsoleAdapter implements ConsoleAdapter {
  readonly capabilities = DESKTOP_CAPABILITIES;

  getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> { return dscBridge.getSnapshot(request); }
  refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> { return dscBridge.refresh(request); }
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void { return dscBridge.subscribe(listener); }
  login(accessKey: string): Promise<DesktopSnapshot> { return dscBridge.login(accessKey); }
  logout(): Promise<DesktopSnapshot> { return dscBridge.logout(); }
  disconnectAgent(): Promise<DesktopSnapshot> { return dscBridge.disconnectAgent(); }
  saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot> { return dscBridge.saveHubConnection(serverUrl, accessKey); }
  deleteInstance(deviceId: string): Promise<DesktopSnapshot> { return dscBridge.deleteInstance(deviceId); }
  reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot> { return dscBridge.reorderInstances(deviceIds); }
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> { return dscBridge.saveFanNote(deviceId, fanId, note); }
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> { return dscBridge.getWidgetLayout(request); }
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> { return dscBridge.saveWidgetLayout(request); }
  openExternal(url: string): Promise<void> { return dscBridge.openExternal(url); }
  updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot> { return dscBridge.updateLocalConfig(patch); }
  controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot> { return dscBridge.controlAgent(action); }
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> { return dscBridge.updateStartupSettings(settings); }
  cloudPush(): Promise<DesktopSnapshot> { return dscBridge.cloudPush(); }
  windowMinimize(): Promise<void> { return dscBridge.windowMinimize(); }
  windowToggleMaximize(): Promise<boolean> { return dscBridge.windowToggleMaximize(); }
  windowClose(): Promise<void> { return dscBridge.windowClose(); }
  windowDragStart(screenX: number, screenY: number): void { dscBridge.windowDragStart(screenX, screenY); }
  windowDragMove(screenX: number, screenY: number): void { dscBridge.windowDragMove(screenX, screenY); }
  windowDragEnd(): void { dscBridge.windowDragEnd(); }
  getWindowMaterialCapabilities(): Promise<WindowMaterialCapabilities> { return dscBridge.getWindowMaterialCapabilities(); }
  setWindowMaterial(material: WindowMaterial): Promise<WindowMaterialCapabilities> { return dscBridge.setWindowMaterial(material); }
  getLocalBackend(): Promise<DesktopAgentBackendState | null> { return dscBridge.getSnapshot().then((snapshot) => snapshot.localBackend); }
}

export const desktopConsoleAdapter = new DesktopConsoleAdapter();

export function createDesktopFallbackAdapter(): ConsoleAdapter {
  return {
    capabilities: DESKTOP_CAPABILITIES,
    getSnapshot: async () => emptyConsoleSnapshot(),
    refresh: async () => emptyConsoleSnapshot(),
    subscribe: () => () => undefined,
    login: async () => emptyConsoleSnapshot(),
    logout: async () => emptyConsoleSnapshot(),
    disconnectAgent: async () => emptyConsoleSnapshot(),
    saveHubConnection: async () => emptyConsoleSnapshot(),
    deleteInstance: async () => emptyConsoleSnapshot(),
    reorderInstances: async () => emptyConsoleSnapshot(),
    saveFanNote: async () => emptyConsoleSnapshot(),
    getWidgetLayout: async (request) => ({ ...request, instanceLayout: null, templates: [] }),
    saveWidgetLayout: async (request) => ({ scopeKey: request.scopeKey, templateKey: request.templateKey, instanceLayout: request.instanceLayout ?? null, templates: [] }),
    openExternal: async () => undefined,
    getWindowMaterialCapabilities: async () => fallbackWindowMaterialCapabilities(),
    setWindowMaterial: async () => fallbackWindowMaterialCapabilities()
  };
}
