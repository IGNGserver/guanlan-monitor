import type {
  DesktopAgentBackendState,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  ConsoleSnapshot,
  ConsoleSnapshotRequest,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import type { ConsoleAdapter, WindowMaterialCapabilities } from "@dsc/console-ui";
import { DESKTOP_CAPABILITIES, emptyConsoleSnapshot, fallbackWindowMaterialCapabilities } from "@dsc/console-ui";
import { dscBridge } from "./dscBridge";

export class DesktopConsoleAdapter implements ConsoleAdapter {
  readonly capabilities = DESKTOP_CAPABILITIES;

  getSnapshot(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> { return dscBridge.getSnapshot(request); }
  refresh(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> { return dscBridge.refresh(request); }
  subscribe(listener: (snapshot: ConsoleSnapshot) => void): () => void { return dscBridge.subscribe(listener); }
  login(accessKey: string): Promise<ConsoleSnapshot> { return dscBridge.login(accessKey); }
  logout(): Promise<ConsoleSnapshot> { return dscBridge.logout(); }
  disconnectAgent(): Promise<ConsoleSnapshot> { return dscBridge.disconnectAgent(); }
  saveHubConnection(serverUrl: string, accessKey: string): Promise<ConsoleSnapshot> { return dscBridge.saveHubConnection(serverUrl, accessKey); }
  deleteInstance(deviceId: string): Promise<ConsoleSnapshot> { return dscBridge.deleteInstance(deviceId); }
  reorderInstances(deviceIds: string[]): Promise<ConsoleSnapshot> { return dscBridge.reorderInstances(deviceIds); }
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<ConsoleSnapshot> { return dscBridge.saveFanNote(deviceId, fanId, note); }
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> { return dscBridge.getWidgetLayout(request); }
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> { return dscBridge.saveWidgetLayout(request); }
  openExternal(url: string): Promise<void> { return dscBridge.openExternal(url); }
  updateLocalConfig(patch: DesktopConfigPatch): Promise<ConsoleSnapshot> { return dscBridge.updateLocalConfig(patch); }
  controlAgent(action: DesktopAgentControlAction): Promise<ConsoleSnapshot> { return dscBridge.controlAgent(action); }
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<ConsoleSnapshot> { return dscBridge.updateStartupSettings(settings); }
  cloudPush(): Promise<ConsoleSnapshot> { return dscBridge.cloudPush(); }
  windowMinimize(): Promise<void> { return dscBridge.windowMinimize(); }
  windowToggleMaximize(): Promise<boolean> { return dscBridge.windowToggleMaximize(); }
  windowClose(): Promise<void> { return dscBridge.windowClose(); }
  windowDragStart(screenX: number, screenY: number): void { dscBridge.windowDragStart(screenX, screenY); }
  windowDragMove(screenX: number, screenY: number): void { dscBridge.windowDragMove(screenX, screenY); }
  windowDragEnd(): void { dscBridge.windowDragEnd(); }
  getWindowMaterialCapabilities(): Promise<WindowMaterialCapabilities> { return dscBridge.getWindowMaterialCapabilities(); }
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
    getWindowMaterialCapabilities: async () => fallbackWindowMaterialCapabilities()
  };
}
