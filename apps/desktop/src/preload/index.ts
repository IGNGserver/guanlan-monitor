import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopRendererBridge,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopStartupSettings
} from "@dsc/shared";
import { IPC_CHANNELS } from "../ipc-contract.js";

const bridge: DesktopRendererBridge = {
  getSnapshot: (request?: DesktopSnapshotRequest) => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot, request),
  refresh: (request?: DesktopSnapshotRequest) => ipcRenderer.invoke(IPC_CHANNELS.refresh, request),
  updateLocalConfig: (patch: DesktopConfigPatch) => ipcRenderer.invoke(IPC_CHANNELS.updateLocalConfig, patch),
  controlAgent: (action: DesktopAgentControlAction) => ipcRenderer.invoke(IPC_CHANNELS.controlAgent, action),
  setAgentSecret: (secret: string) => ipcRenderer.invoke(IPC_CHANNELS.setAgentSecret, secret),
  login: (accessKey: string) => ipcRenderer.invoke(IPC_CHANNELS.login, accessKey),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  cloudPush: () => ipcRenderer.invoke(IPC_CHANNELS.cloudPush),
  saveFanNote: (deviceId: string, fanId: string, note: string) => ipcRenderer.invoke(IPC_CHANNELS.saveFanNote, deviceId, fanId, note),
  updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => ipcRenderer.invoke(IPC_CHANNELS.updateStartupSettings, settings),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  exit: () => ipcRenderer.invoke(IPC_CHANNELS.exit),
  subscribe: (listener: (snapshot: DesktopSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: DesktopSnapshot) => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshot, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshot, handler);
  }
};

contextBridge.exposeInMainWorld("dsc", bridge);
