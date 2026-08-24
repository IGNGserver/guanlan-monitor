import type {
  DesktopRendererBridge,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import {
  createFallbackWindowMaterialCapabilities,
  type WindowMaterialBridge,
  type WindowMaterialCapabilities
} from "../../window-material";

class SafeDscBridge implements DesktopRendererBridge, WindowMaterialBridge {
  private fallbackSnapshot: DesktopSnapshot = createEmptySnapshot();

  private get bridge(): (DesktopRendererBridge & WindowMaterialBridge) | null {
    if (typeof window !== "undefined" && window.dsc) {
      return window.dsc;
    }
    return null;
  }

  async getSnapshot(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    if (this.bridge) {
      return await this.bridge.getSnapshot(request);
    }
    this.fallbackSnapshot = createEmptySnapshot(request);
    return this.fallbackSnapshot;
  }

  async refresh(request?: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
    if (this.bridge) {
      return await this.bridge.refresh(request);
    }
    this.fallbackSnapshot = createEmptySnapshot(request);
    return this.fallbackSnapshot;
  }

  async updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot> {
    return this.requireBridge().updateLocalConfig(patch);
  }

  async controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot> {
    return this.requireBridge().controlAgent(action);
  }

  async setAgentSecret(secret: string): Promise<DesktopSnapshot> {
    return this.requireBridge().setAgentSecret(secret);
  }

  async saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot> {
    return this.requireBridge().saveHubConnection(serverUrl, accessKey);
  }

  async login(accessKey: string): Promise<DesktopSnapshot> {
    return this.requireBridge().login(accessKey);
  }

  async logout(): Promise<DesktopSnapshot> {
    return this.requireBridge().logout();
  }

  async disconnectAgent(): Promise<DesktopSnapshot> {
    return this.requireBridge().disconnectAgent();
  }

  async cloudPush(): Promise<DesktopSnapshot> {
    return this.requireBridge().cloudPush();
  }

  async getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> {
    return this.requireBridge().getWidgetLayout(request);
  }

  async saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    return this.requireBridge().saveWidgetLayout(request);
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> {
    return this.requireBridge().saveFanNote(deviceId, fanId, note);
  }

  async deleteInstance(deviceId: string): Promise<DesktopSnapshot> {
    return this.requireBridge().deleteInstance(deviceId);
  }

  async reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot> {
    return this.requireBridge().reorderInstances(deviceIds);
  }

  async updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> {
    return this.requireBridge().updateStartupSettings(settings);
  }

  async openExternal(url: string): Promise<void> {
    return this.requireBridge().openExternal(url);
  }

  async getWindowMaterialCapabilities(): Promise<WindowMaterialCapabilities> {
    const bridge = this.bridge;
    return bridge ? await bridge.getWindowMaterialCapabilities() : createFallbackWindowMaterialCapabilities();
  }

  async windowMinimize(): Promise<void> {
    return this.requireBridge().windowMinimize();
  }

  async windowToggleMaximize(): Promise<boolean> {
    return this.requireBridge().windowToggleMaximize();
  }

  windowDragStart(screenX: number, screenY: number): void {
    this.bridge?.windowDragStart(screenX, screenY);
  }

  windowDragMove(screenX: number, screenY: number): void {
    this.bridge?.windowDragMove(screenX, screenY);
  }

  windowDragEnd(): void {
    this.bridge?.windowDragEnd();
  }

  async windowClose(): Promise<void> {
    return this.requireBridge().windowClose();
  }

  async exit(): Promise<void> {
    return this.requireBridge().exit();
  }

  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    if (this.bridge) {
      return this.bridge.subscribe(listener);
    }
    return () => undefined;
  }

  private requireBridge(): DesktopRendererBridge {
    const bridge = this.bridge;
    if (!bridge) throw new Error("desktop_bridge_unavailable");
    return bridge;
  }
}

export const dscBridge = new SafeDscBridge();

function createEmptySnapshot(request?: DesktopSnapshotRequest): DesktopSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    source: "empty",
    cache: { available: false, savedAt: null, ageSeconds: null },
    session: { authenticated: false, accessKeyConfigured: false },
    localBackend: null,
    devices: [],
    selectedDeviceId: request?.selectedDeviceId ?? null,
    metrics: null,
    overviewMetrics: null,
    trafficCalendar: null,
    update: null,
    startup: { openAtLogin: false, startMinimized: false }
  };
}
