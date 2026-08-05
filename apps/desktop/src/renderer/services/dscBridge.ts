import type {
  DesktopRendererBridge,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopConfigPatch,
  DesktopAgentControlAction,
  DesktopStartupSettings
} from "@dsc/shared";

class SafeDscBridge implements DesktopRendererBridge {
  private fallbackSnapshot: DesktopSnapshot = createEmptySnapshot();

  private get bridge(): DesktopRendererBridge | null {
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

  async cloudPush(): Promise<DesktopSnapshot> {
    return this.requireBridge().cloudPush();
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> {
    return this.requireBridge().saveFanNote(deviceId, fanId, note);
  }

  async updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> {
    return this.requireBridge().updateStartupSettings(settings);
  }

  async openExternal(url: string): Promise<void> {
    return this.requireBridge().openExternal(url);
  }

  async windowMinimize(): Promise<void> {
    return this.requireBridge().windowMinimize();
  }

  async windowToggleMaximize(): Promise<boolean> {
    return this.requireBridge().windowToggleMaximize();
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
    trafficCalendar: null,
    update: null,
    startup: { openAtLogin: false, startMinimized: false }
  };
}
