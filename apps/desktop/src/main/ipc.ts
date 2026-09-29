import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import type {
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopWindowState,
  MetricWindow,
  DesktopSnapshotRequest,
  DesktopStartupSettings,
  TrafficCalendarMode
} from "@dsc/shared";
import { DesktopController } from "./controller.js";
import { IPC_CHANNELS } from "../ipc-contract.js";
import {
  MIN_WINDOWS_MATERIAL_BUILD,
  resolveWindowMaterial,
  type WindowMaterialCapabilities
} from "../window-material.js";
import { getDesktopRuntimeProfile } from "./runtime-profile.js";
import { isTrustedRendererUrl } from "./renderer-security.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../renderer");

export function registerIpc(
  controller: DesktopController,
  getWindow: () => BrowserWindow | null,
  markQuitting: () => void,
  gpuFallbackActive: boolean
): void {
  const windowDragOffsets = new Map<number, { x: number; y: number }>();

  const handle = (channel: string, handler: IpcHandler) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event, getWindow);
      return handler(event, ...args);
    });
  };

  handle(IPC_CHANNELS.getSnapshot, (_event, request?: DesktopSnapshotRequest) => controller.getSnapshot(asSnapshotRequest(request)));
  handle(IPC_CHANNELS.refresh, (_event, request?: DesktopSnapshotRequest) => {
    const snapshotRequest = asSnapshotRequest(request);
    // With the window hidden the renderer may still be polling (Electron does not
    // always report a hidden window as document.hidden). Answer from the current
    // snapshot instead of driving a full hub round trip for a view nobody sees;
    // the show handler in main refreshes immediately when the window returns.
    if (!isWindowVisible(getWindow)) return controller.getSnapshot(snapshotRequest);
    return controller.refresh(snapshotRequest);
  });
  handle(IPC_CHANNELS.updateLocalConfig, (_event, patch: DesktopConfigPatch) => controller.updateLocalConfig(asConfigPatch(patch)));
  handle(IPC_CHANNELS.controlAgent, (_event, action: DesktopAgentControlAction) => controller.controlAgent(asControlAction(action)));
  handle(IPC_CHANNELS.saveHubConnection, (_event, serverUrl: string, accessKey: string) => controller.saveHubConnection(asString(serverUrl, "server_url"), asString(accessKey, "access_key")));
  handle(IPC_CHANNELS.login, (_event, accessKey: string) => controller.login(asString(accessKey, "access_key")));
  handle(IPC_CHANNELS.logout, () => controller.logout());
  handle(IPC_CHANNELS.disconnectAgent, () => controller.disconnectAgent());
  handle(IPC_CHANNELS.cloudPush, () => controller.cloudPush());
  handle(IPC_CHANNELS.saveFanNote, (_event, deviceId: string, fanId: string, note: string) => controller.saveFanNote(asString(deviceId, "device_id"), asString(fanId, "fan_id"), asString(note, "fan_note")));
  handle(IPC_CHANNELS.deleteInstance, (_event, deviceId: string) => controller.deleteInstance(asString(deviceId, "device_id")));
  handle(IPC_CHANNELS.reorderInstances, (_event, deviceIds: unknown) => controller.reorderInstances(asStringArray(deviceIds, "device_ids")));
  handle(IPC_CHANNELS.updateStartupSettings, (_event, settings) => controller.updateStartupSettings(asStartupSettings(settings)));
  handle(IPC_CHANNELS.openExternal, (_event, url: string) => controller.openExternal(asString(url, "external_url")));
  handle(IPC_CHANNELS.getRuntimeProfile, () => getDesktopRuntimeProfile(gpuFallbackActive));
  handle(IPC_CHANNELS.getWindowMaterialCapabilities, () => getWindowMaterialCapabilities(getWindow(), gpuFallbackActive));
  handle(IPC_CHANNELS.getWindowState, () => readWindowState(getWindow()));
  handle(IPC_CHANNELS.windowMinimize, () => {
    getWindow()?.minimize();
  });
  handle(IPC_CHANNELS.windowToggleMaximize, () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return false;
    // Report the intended state, not `isMaximized()` read straight after the
    // call: on Windows the restored/maximized flag is not settled synchronously,
    // so the renderer's toggle icon could disagree with the real window until the
    // next unrelated click.
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }
    window.maximize();
    return true;
  });
  ipcMain.on(IPC_CHANNELS.windowDragStart, (event, screenX: unknown, screenY: unknown) => {
    if (!isTrustedIpcSender(event, getWindow)) return;
    windowDragOffsets.delete(event.sender.id);
    if (!isFiniteScreenCoordinate(screenX) || !isFiniteScreenCoordinate(screenY)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || window.isMaximized()) return;
    const [windowX, windowY] = window.getPosition();
    windowDragOffsets.set(event.sender.id, { x: screenX - windowX, y: screenY - windowY });
  });
  ipcMain.on(IPC_CHANNELS.windowDragMove, (event, screenX: unknown, screenY: unknown) => {
    if (!isTrustedIpcSender(event, getWindow)) return;
    if (!isFiniteScreenCoordinate(screenX) || !isFiniteScreenCoordinate(screenY)) return;
    const offset = windowDragOffsets.get(event.sender.id);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!offset || !window || window.isDestroyed() || window.isMaximized()) return;
    window.setPosition(Math.round(screenX - offset.x), Math.round(screenY - offset.y));
  });
  ipcMain.on(IPC_CHANNELS.windowDragEnd, (event) => {
    if (!isTrustedIpcSender(event, getWindow)) return;
    windowDragOffsets.delete(event.sender.id);
  });
  handle(IPC_CHANNELS.windowClose, () => {
    getWindow()?.close();
  });
  handle(IPC_CHANNELS.exit, async () => {
    markQuitting();
    await controller.shutdown();
    app.quit();
  });

  controller.subscribe((snapshot) => {
    // A tray-resident window must not keep paying for a renderer that nobody can
    // see. Every pushed snapshot re-renders the whole console, including the
    // chart tiles, so pushing to a hidden or minimized window is pure waste. The
    // renderer re-reads on the way back up (see the show handler in main).
    if (!isWindowVisible(getWindow)) return;
    getWindow()?.webContents.send(IPC_CHANNELS.snapshot, snapshot);
  });

  /* Push native window-state changes so the caption buttons never have to guess.
   *
   * The user can maximize, restore, snap, or enter fullscreen from the taskbar,
   * a keyboard shortcut, or a window-manager gesture — none of which routes
   * through the renderer's toggle handler. `maximize`/`unmaximize` cover the
   * Windows and Linux paths; the fullscreen pair covers macOS and any host where
   * a window can still request fullscreen. */
  const window = getWindow();
  if (window && !window.isDestroyed()) {
    const emitWindowState = () => {
      if (window.isDestroyed()) return;
      window.webContents.send(IPC_CHANNELS.windowStateChanged, readWindowState(window));
    };
    window.on("maximize", emitWindowState);
    window.on("unmaximize", emitWindowState);
    window.on("enter-full-screen", emitWindowState);
    window.on("leave-full-screen", emitWindowState);
    window.once("closed", () => {
      window.removeListener("maximize", emitWindowState);
      window.removeListener("unmaximize", emitWindowState);
      window.removeListener("enter-full-screen", emitWindowState);
      window.removeListener("leave-full-screen", emitWindowState);
    });
  }
}

function readWindowState(window: BrowserWindow | null): DesktopWindowState {
  if (!window || window.isDestroyed()) return { maximized: false, fullscreen: false };
  return {
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen()
  };
}

/**
 * Whether the console window is on screen and worth refreshing.
 *
 * A minimized or hidden window is not being read, and refreshing it costs a hub
 * round trip plus a full re-render of the chart tiles. A missing window counts as
 * not worth refreshing.
 */
function isWindowVisible(getWindow: () => BrowserWindow | null): boolean {
  const window = getWindow();
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) return false;
  return window.isVisible();
}

type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown;

function assertTrustedIpcSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  getWindow: () => BrowserWindow | null
): void {
  const window = getWindow();
  if (!window || window.isDestroyed() || BrowserWindow.fromWebContents(event.sender) !== window) {
    throw new Error("untrusted_ipc_sender");
  }
  const devServerUrl = process.env.DSC_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL;
  const senderUrl = "senderFrame" in event && event.senderFrame ? event.senderFrame.url : event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl, rendererRoot, devServerUrl)) {
    throw new Error("untrusted_ipc_origin");
  }
}

function isTrustedIpcSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
  getWindow: () => BrowserWindow | null
): boolean {
  try {
    assertTrustedIpcSender(event, getWindow);
    return true;
  } catch {
    return false;
  }
}

function isFiniteScreenCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getWindowsBuild(): number | null {
  const electronProcess = process as NodeJS.Process & { getSystemVersion?: () => string };
  if (process.platform !== "win32" || typeof electronProcess.getSystemVersion !== "function") return null;
  const match = electronProcess.getSystemVersion().match(/^\d+\.\d+\.(\d+)/);
  return match ? Number(match[1]) : null;
}

function getWindowMaterialCapabilities(window: BrowserWindow | null, gpuFallbackActive: boolean): WindowMaterialCapabilities {
  const windowsBuild = getWindowsBuild();
  const prefersReducedTransparency = process.platform === "win32" && nativeTheme.prefersReducedTransparency;
  const runtimeProfile = getDesktopRuntimeProfile(gpuFallbackActive);
  const nativeMaterialSupported = Boolean(
    process.platform === "win32" &&
    windowsBuild !== null &&
    windowsBuild >= MIN_WINDOWS_MATERIAL_BUILD &&
    window &&
    !window.isDestroyed() &&
    typeof window.setBackgroundMaterial === "function" &&
    !prefersReducedTransparency
  );
  const platform = process.platform === "win32" ? "windows" : "other";
  const activeMaterial = runtimeProfile.useOpaqueWindow ? "opaque" : resolveWindowMaterial({
    platform,
    windowsBuild,
    prefersReducedTransparency,
    supportsNativeMaterial: nativeMaterialSupported
  });

  return {
    platform,
    windowsBuild,
    supportsMica: activeMaterial === "mica",
    prefersReducedTransparency,
    activeMaterial
  };
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`invalid_${field}`);
  return value as string[];
}

function asRecord<T extends object = Record<string, unknown>>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as T;
  return value as T;
}

function asSnapshotRequest(value: unknown): DesktopSnapshotRequest {
  const record = asRecord(value);
  const request: DesktopSnapshotRequest = {};
  if (record.metricWindow !== undefined) request.metricWindow = asMetricWindow(record.metricWindow);
  if (record.selectedDeviceId !== undefined) {
    if (record.selectedDeviceId !== null) request.selectedDeviceId = asString(record.selectedDeviceId, "selected_device_id");
    else request.selectedDeviceId = null;
  }
  if (record.trafficMode !== undefined) request.trafficMode = asTrafficMode(record.trafficMode);
  if (record.trafficAnchor !== undefined) request.trafficAnchor = asString(record.trafficAnchor, "traffic_anchor");
  if (record.preferCache !== undefined) {
    if (typeof record.preferCache !== "boolean") throw new Error("invalid_prefer_cache");
    request.preferCache = record.preferCache;
  }
  return request;
}

function asConfigPatch(value: unknown): DesktopConfigPatch {
  const patch = asRecord<DesktopConfigPatch>(value);
  const connection = asRecord(patch.connection);
  if ("secret" in connection) throw new Error("secret_must_use_dedicated_channel");
  return patch;
}

function asStartupSettings(value: unknown): Partial<DesktopStartupSettings> {
  const record = asRecord(value);
  const settings: Partial<DesktopStartupSettings> = {};
  for (const key of ["openAtLogin", "startMinimized"] as const) {
    const settingValue = record[key];
    if (settingValue === undefined) continue;
    if (typeof settingValue !== "boolean") throw new Error(`invalid_${key}`);
    settings[key] = settingValue;
  }
  return settings;
}

function asMetricWindow(value: unknown): MetricWindow {
  const allowed: MetricWindow[] = ["1m", "5m", "15m", "1h", "6h", "24h", "1d", "7d", "1w", "30d", "1mo", "90d", "1y"];
  if (typeof value === "string" && allowed.includes(value as MetricWindow)) return value as MetricWindow;
  throw new Error("invalid_metric_window");
}

function asTrafficMode(value: unknown): TrafficCalendarMode {
  if (value === "day" || value === "week" || value === "month") return value;
  throw new Error("invalid_traffic_mode");
}

function asControlAction(value: unknown): DesktopAgentControlAction {
  if (value === "start" || value === "stop" || value === "restart" || value === "check-connection" || value === "detect-probes") return value;
  throw new Error("invalid_agent_control_action");
}
