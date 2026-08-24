import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopRendererBridge,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest
} from "@dsc/shared";
import { IPC_CHANNELS } from "../ipc-contract.js";
import type { WindowMaterialBridge } from "../window-material.js";

const bridge: DesktopRendererBridge & WindowMaterialBridge = {
  getSnapshot: (request?: DesktopSnapshotRequest) => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot, request),
  refresh: (request?: DesktopSnapshotRequest) => ipcRenderer.invoke(IPC_CHANNELS.refresh, request),
  updateLocalConfig: (patch: DesktopConfigPatch) => ipcRenderer.invoke(IPC_CHANNELS.updateLocalConfig, patch),
  controlAgent: (action: DesktopAgentControlAction) => ipcRenderer.invoke(IPC_CHANNELS.controlAgent, action),
  setAgentSecret: (secret: string) => ipcRenderer.invoke(IPC_CHANNELS.setAgentSecret, secret),
  saveHubConnection: (serverUrl: string, accessKey: string) => ipcRenderer.invoke(IPC_CHANNELS.saveHubConnection, serverUrl, accessKey),
  login: (accessKey: string) => ipcRenderer.invoke(IPC_CHANNELS.login, accessKey),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  disconnectAgent: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectAgent),
  cloudPush: () => ipcRenderer.invoke(IPC_CHANNELS.cloudPush),
  getWidgetLayout: (request: WidgetLayoutRequest) => ipcRenderer.invoke(IPC_CHANNELS.getWidgetLayout, request),
  saveWidgetLayout: (request: WidgetLayoutSaveRequest) => ipcRenderer.invoke(IPC_CHANNELS.saveWidgetLayout, request),
  saveFanNote: (deviceId: string, fanId: string, note: string) => ipcRenderer.invoke(IPC_CHANNELS.saveFanNote, deviceId, fanId, note),
  deleteInstance: (deviceId: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteInstance, deviceId),
  reorderInstances: (deviceIds: string[]) => ipcRenderer.invoke(IPC_CHANNELS.reorderInstances, deviceIds),
  updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => ipcRenderer.invoke(IPC_CHANNELS.updateStartupSettings, settings),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  getWindowMaterialCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.getWindowMaterialCapabilities),
  windowMinimize: () => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  windowToggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
  windowDragStart: (screenX: number, screenY: number) => { ipcRenderer.send(IPC_CHANNELS.windowDragStart, screenX, screenY); },
  windowDragMove: (screenX: number, screenY: number) => { ipcRenderer.send(IPC_CHANNELS.windowDragMove, screenX, screenY); },
  windowDragEnd: () => { ipcRenderer.send(IPC_CHANNELS.windowDragEnd); },
  windowClose: () => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
  exit: () => ipcRenderer.invoke(IPC_CHANNELS.exit),
  subscribe: (listener: (snapshot: DesktopSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshot, handler);
  }
};

contextBridge.exposeInMainWorld("dsc", bridge);
