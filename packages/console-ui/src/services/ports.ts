import type {
  ConsoleSnapshot,
  ConsoleSnapshotRequest,
  DesktopAgentBackendState,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";

/** Read-only state access shared by the Web and Electron shells. */
export interface ConsoleReadPort {
  getSnapshot(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot>;
  refresh(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot>;
  subscribe(listener: (snapshot: ConsoleSnapshot) => void): () => void;
}

/** Authentication and session operations exposed by both transports. */
export interface ConsoleSessionPort {
  login(accessKey: string): Promise<ConsoleSnapshot>;
  logout(): Promise<ConsoleSnapshot>;
  disconnectAgent(): Promise<ConsoleSnapshot>;
  saveHubConnection(serverUrl: string, accessKey: string): Promise<ConsoleSnapshot>;
}

/** Hub-backed fleet operations that do not require local OS access. */
export interface ConsoleFleetPort {
  deleteInstance(deviceId: string): Promise<ConsoleSnapshot>;
  reorderInstances(deviceIds: string[]): Promise<ConsoleSnapshot>;
  saveFanNote(deviceId: string, fanId: string, note: string): Promise<ConsoleSnapshot>;
  getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync>;
  saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync>;
  openExternal(url: string): Promise<void>;
}

/** Local Agent operations are implemented by the desktop shell only. */
export interface ConsoleLocalAgentPort {
  updateLocalConfig(patch: DesktopConfigPatch): Promise<ConsoleSnapshot>;
  controlAgent(action: DesktopAgentControlAction): Promise<ConsoleSnapshot>;
  updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<ConsoleSnapshot>;
  cloudPush(): Promise<ConsoleSnapshot>;
  getLocalBackend(): Promise<DesktopAgentBackendState | null>;
}
