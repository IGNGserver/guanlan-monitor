import type {
  ConsoleSnapshot,
  ConsoleSnapshotRequest,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopStartupSettings
} from "@dsc/shared";
import type { ConsoleAdapter, ConsoleLocalAgentPort, WindowMaterialCapabilities } from "@dsc/console-ui";
import { DESKTOP_CAPABILITIES, emptyConsoleSnapshot, fallbackRuntimeProfile, fallbackWindowMaterialCapabilities } from "@dsc/console-ui";
import { dscBridge } from "./dscBridge";

/**
 * The Electron adapter. `ConsoleLocalAgentPort` is implemented explicitly rather
 * than declared optional, so dropping one of the desktop-only operations fails
 * `pnpm check:adapter-contracts` at the source that forgot it.
 */
export class DesktopConsoleAdapter implements ConsoleAdapter, ConsoleLocalAgentPort {
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
  getRuntimeProfile() { return dscBridge.getRuntimeProfile(); }
}

export const desktopConsoleAdapter = new DesktopConsoleAdapter();

const DESKTOP_BRIDGE_NOT_READY = "desktop_bridge_not_ready";

export function createDesktopFallbackAdapter(): ConsoleAdapter {
  const notReady = async (): Promise<ConsoleSnapshot> => { throw new Error(DESKTOP_BRIDGE_NOT_READY); };
  return {
    capabilities: DESKTOP_CAPABILITIES,
    getSnapshot: async () => emptyConsoleSnapshot(),
    refresh: async () => emptyConsoleSnapshot(),
    subscribe: () => () => undefined,
    login: notReady,
    logout: notReady,
    disconnectAgent: notReady,
    saveHubConnection: notReady,
    deleteInstance: notReady,
    reorderInstances: notReady,
    saveFanNote: notReady,
    openExternal: async () => undefined,
    updateLocalConfig: notReady,
    controlAgent: notReady,
    updateStartupSettings: notReady,
    cloudPush: notReady,
    windowMinimize: async () => undefined,
    windowToggleMaximize: async () => false,
    windowClose: async () => undefined,
    windowDragStart: () => undefined,
    windowDragMove: () => undefined,
    windowDragEnd: () => undefined,
    getWindowMaterialCapabilities: async () => fallbackWindowMaterialCapabilities(),
    getRuntimeProfile: async () => fallbackRuntimeProfile()
  };
}
