import { app, shell } from "electron";
import path from "node:path";
import type {
  DesktopAgentBackendState,
  DesktopAgentControlAction,
  DesktopConfigPatch,
  DesktopRendererBridge,
  DesktopSnapshot,
  DesktopSnapshotRequest,
  DesktopStartupSettings,
  MetricWindow,
  TrafficCalendarMode
} from "@dsc/shared";
import { AgentManager } from "./agent-manager.js";
import { readJsonFile, writeJsonAtomically } from "./atomic-json.js";
import { DesktopCacheStore } from "./cache-store.js";
import { credentialFilePath, HubClient } from "./hub-client.js";
import { LocalConfigStore } from "./local-config.js";
import type { AgentBackendConfig, RawAgentBackendState } from "./types.js";

const DEFAULT_METRIC_WINDOW: MetricWindow = "1m";
const DEFAULT_TRAFFIC_MODE: TrafficCalendarMode = "day";

export class DesktopController {
  readonly bridge: Omit<DesktopRendererBridge, "subscribe" | "windowMinimize" | "windowToggleMaximize" | "windowClose">;
  private readonly agent: AgentManager;
  private readonly hub: HubClient;
  private readonly cache: DesktopCacheStore;
  private readonly localConfig: LocalConfigStore;
  private readonly listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private currentSnapshot: DesktopSnapshot | null = null;
  private metricWindow: MetricWindow = DEFAULT_METRIC_WINDOW;
  private selectedDeviceId: string | null = null;
  private trafficMode: TrafficCalendarMode = DEFAULT_TRAFFIC_MODE;
  private trafficAnchor = new Date().toISOString();
  private startup: DesktopStartupSettings = { openAtLogin: false, startMinimized: false };

  constructor() {
    const userDataPath = app.getPath("userData");
    const localAppDataPath = process.env.LOCALAPPDATA ?? path.join(path.dirname(app.getPath("appData")), "Local");
    const legacyPaths = [
      path.join(localAppDataPath, "DeviceStateConsoleAgent", "agent-ui.config.json"),
      `${app.getPath("appData")}\\DeviceStateConsole\\agent-ui.config.json`,
      `${app.getPath("appData")}\\device-state-console\\agent-ui.config.json`,
      `${process.cwd()}\\agent-ui.config.json`
    ];
    this.agent = new AgentManager({
      userDataPath,
      resourcesPath: process.resourcesPath,
      backendBinary: process.env.DSC_BACKEND_BINARY
    });
    this.hub = new HubClient(credentialFilePath(userDataPath));
    this.cache = new DesktopCacheStore(userDataPath);
    this.localConfig = new LocalConfigStore(userDataPath, legacyPaths);
    this.bridge = {
      getSnapshot: (request?: DesktopSnapshotRequest) => this.getSnapshot(request),
      refresh: (request?: DesktopSnapshotRequest) => this.refresh(request),
      updateLocalConfig: (patch: DesktopConfigPatch) => this.updateLocalConfig(patch),
      controlAgent: (action: DesktopAgentControlAction) => this.controlAgent(action),
      setAgentSecret: (secret: string) => this.setAgentSecret(secret),
      saveHubConnection: (serverUrl: string, accessKey: string) => this.saveHubConnection(serverUrl, accessKey),
      login: (accessKey: string) => this.login(accessKey),
      logout: () => this.logout(),
      cloudPush: () => this.cloudPush(),
      saveFanNote: (deviceId: string, fanId: string, note: string) => this.saveFanNote(deviceId, fanId, note),
      updateStartupSettings: (settings: Partial<DesktopStartupSettings>) => this.updateStartupSettings(settings),
      openExternal: (url: string) => this.openExternal(url),
      exit: () => this.shutdown()
    };
  }

  async initialize(): Promise<void> {
    await Promise.all([this.hub.initialize(), this.localConfig.migrateIfNeeded()]);
    let preferences: Partial<DesktopStartupSettings> | null = null;
    try {
      preferences = await readJsonFile<Partial<DesktopStartupSettings>>(
        path.join(app.getPath("userData"), "desktop-preferences.json")
      );
    } catch {
      // Corrupt preferences should not prevent the desktop shell from opening.
    }
    this.startup = {
      openAtLogin: preferences?.openAtLogin ?? app.getLoginItemSettings().openAtLogin,
      startMinimized: preferences?.startMinimized ?? false
    };
    app.setLoginItemSettings({ openAtLogin: this.startup.openAtLogin });
  }

  get startupSettings(): DesktopStartupSettings {
    return { ...this.startup };
  }

  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSnapshot(request: DesktopSnapshotRequest = {}): Promise<DesktopSnapshot> {
    const requestChanged = this.applyRequest(request);
    if (request.preferCache) {
      try {
        const cached = await this.cache.read();
        if (cached) return this.asCachedSnapshot(cached);
      } catch {
        // A corrupt cache falls through to the live refresh path.
      }
    }
    if (this.currentSnapshot && !requestChanged) return this.currentSnapshot;
    return this.refresh(request);
  }

  async refresh(request: DesktopSnapshotRequest = {}): Promise<DesktopSnapshot> {
    this.applyRequest(request);
    let cached: DesktopSnapshot | null = null;
    try {
      cached = await this.cache.read();
    } catch {
      // A corrupt cache should degrade to live/empty state, never block refresh.
    }
    try {
      const rawState = await this.agent.start();
      this.hub.setServerUrl(rawState.config.connection.serverUrl);
      const live = await this.readLiveData(rawState);
      const snapshot = this.createSnapshot("live", live, cached);
      this.currentSnapshot = snapshot;
      if (snapshot.source === "live") {
        try {
          await this.cache.write(snapshot);
        } catch {
          // Cache persistence is best-effort; it must not hide live telemetry.
        }
      }
      this.notify(snapshot);
      return snapshot;
    } catch (error) {
      const fallback = cached ? this.asCachedSnapshot(cached, error) : this.emptySnapshot(error);
      this.currentSnapshot = fallback;
      this.notify(fallback);
      return fallback;
    }
  }

  async updateLocalConfig(patch: DesktopConfigPatch): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    const nextConfig = mergeAgentConfig(rawState.config, patch);
    await this.agent.updateConfig(nextConfig);
    return this.refresh();
  }

  async controlAgent(action: DesktopAgentControlAction): Promise<DesktopSnapshot> {
    await this.agent.control(action);
    return this.refresh();
  }

  async setAgentSecret(secret: string): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    const nextConfig: AgentBackendConfig = {
      ...rawState.config,
      connection: {
        ...rawState.config.connection,
        secret: secret.trim()
      }
    };
    await this.agent.updateConfig(nextConfig);
    return this.refresh();
  }

  async saveHubConnection(serverUrl: string, accessKey: string): Promise<DesktopSnapshot> {
    const normalizedUrl = serverUrl.trim();
    const normalizedAccessKey = accessKey.trim();
    if (!normalizedUrl) throw new Error("hub_server_url_required");
    if (!this.hub.setServerUrl(normalizedUrl)) throw new Error("hub_server_url_invalid");
    const unifiedCredential = normalizedAccessKey || this.hub.credentialForAgent;
    if (!unifiedCredential) throw new Error("hub_access_key_required");

    const rawState = await this.agent.start();
    // The Hub ACCESS_KEY is the single credential for web, desktop and Agent uploads.
    // Keep the Agent's internal runtime config in sync without exposing a second secret field.
    await this.hub.login(unifiedCredential);

    const nextConfig = mergeAgentConfig(rawState.config, { connection: { serverUrl: normalizedUrl } });
    nextConfig.connection.secret = unifiedCredential;
    await this.agent.updateConfig(nextConfig);
    return this.refresh();
  }

  async login(accessKey: string): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    if (!this.hub.setServerUrl(rawState.config.connection.serverUrl)) throw new Error("hub_server_url_missing");
    const normalizedAccessKey = accessKey.trim();
    await this.hub.login(normalizedAccessKey);
    const nextConfig = mergeAgentConfig(rawState.config, {});
    nextConfig.connection.secret = normalizedAccessKey;
    await this.agent.updateConfig(nextConfig);
    return this.refresh();
  }

  async logout(): Promise<DesktopSnapshot> {
    await this.hub.logout();
    return this.refresh();
  }

  async cloudPush(): Promise<DesktopSnapshot> {
    await this.agent.cloudPush();
    return this.refresh();
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    this.hub.setServerUrl(rawState.config.connection.serverUrl);
    await this.hub.saveFanNote(deviceId, fanId, note);
    return this.refresh({ selectedDeviceId: deviceId });
  }

  async updateStartupSettings(settings: Partial<DesktopStartupSettings>): Promise<DesktopSnapshot> {
    this.startup = {
      openAtLogin: settings.openAtLogin ?? this.startup.openAtLogin,
      startMinimized: settings.startMinimized ?? this.startup.startMinimized
    };
    app.setLoginItemSettings({ openAtLogin: this.startup.openAtLogin });
    await writeJsonAtomically(path.join(app.getPath("userData"), "desktop-preferences.json"), this.startup);
    return this.refresh();
  }

  async openExternal(url: string): Promise<void> {
    const parsed = new URL(url);
    if (!(["https:", "http:"].includes(parsed.protocol))) throw new Error("external_url_scheme_not_allowed");
    await shell.openExternal(parsed.toString());
  }

  async shutdown(): Promise<void> {
    await this.agent.stop();
  }

  private async readLiveData(rawState: RawAgentBackendState) {
    const localBackend = redactBackendState(rawState);
    const localDeviceId = rawState.config.connection.deviceId.trim() || null;
    let devices = [] as DesktopSnapshot["devices"];
    let selectedDeviceId = this.selectedDeviceId ?? localDeviceId;
    let metrics: DesktopSnapshot["metrics"] = null;
    let trafficCalendar: DesktopSnapshot["trafficCalendar"] = null;
    let update: DesktopSnapshot["update"] = null;
    let authenticated = false;

    try {
      devices = await this.hub.listDevices();
      authenticated = true;
      if (!selectedDeviceId && devices.length > 0) selectedDeviceId = devices[0].deviceId;
    } catch {
      // Local telemetry and cached Hub data remain useful while signed out/offline.
    }

    if (selectedDeviceId && this.hub.isConfigured) {
      try {
        metrics = await this.hub.getMetrics(selectedDeviceId, this.metricWindow);
        trafficCalendar = await this.hub.getTrafficCalendar(selectedDeviceId, this.trafficMode, this.trafficAnchor);
      } catch {
        metrics = null;
        trafficCalendar = null;
      }
    }

    try {
      update = await this.hub.getUpdateInfo(currentDesktopVersion());
    } catch {
      update = null;
    }

    this.selectedDeviceId = selectedDeviceId;
    return {
      localBackend,
      devices,
      selectedDeviceId,
      metrics,
      trafficCalendar,
      update,
      authenticated
    };
  }

  private createSnapshot(source: "live" | "empty", live: Awaited<ReturnType<DesktopController["readLiveData"]>>, cached: DesktopSnapshot | null): DesktopSnapshot {
    const now = new Date().toISOString();
    const cachedRemote = !live.authenticated ? cached : null;
    const usingCachedRemote = Boolean(cachedRemote && live.devices.length === 0 && live.metrics === null && live.trafficCalendar === null);
    const snapshot: DesktopSnapshot = {
      generatedAt: now,
      source: usingCachedRemote ? "cache" : source,
      cache: cacheState(cached),
      session: {
        authenticated: live.authenticated,
        accessKeyConfigured: this.hub.isConfigured
      },
      localBackend: live.localBackend,
      devices: usingCachedRemote ? cachedRemote?.devices ?? [] : live.devices,
      selectedDeviceId: usingCachedRemote ? cachedRemote?.selectedDeviceId ?? live.selectedDeviceId : live.selectedDeviceId,
      metrics: usingCachedRemote ? cachedRemote?.metrics ?? null : live.metrics,
      trafficCalendar: usingCachedRemote ? cachedRemote?.trafficCalendar ?? null : live.trafficCalendar,
      update: usingCachedRemote ? cachedRemote?.update ?? null : live.update,
      startup: this.startup
    };
    return snapshot;
  }

  private asCachedSnapshot(cached: DesktopSnapshot, error?: unknown): DesktopSnapshot {
    const now = new Date().toISOString();
    return {
      ...cached,
      generatedAt: now,
      source: "cache",
      cache: cacheState(cached),
      session: {
        authenticated: false,
        accessKeyConfigured: this.hub.isConfigured
      },
      update: error ? null : cached.update,
      startup: this.startup
    };
  }

  private emptySnapshot(_error?: unknown): DesktopSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      source: "empty",
      cache: { available: false, savedAt: null, ageSeconds: null },
      session: { authenticated: false, accessKeyConfigured: this.hub.isConfigured },
      localBackend: null,
      devices: [],
      selectedDeviceId: null,
      metrics: null,
      trafficCalendar: null,
      update: { currentVersion: currentDesktopVersion(), currentChannel: "test", platform: process.platform === "win32" ? "windows-gui" : "linux-gui", arch: process.arch, available: false, latestVersion: null, latestChannel: null, releaseTag: null, releaseUrl: null, notesUrl: null, publishedAt: null, assetName: null, assetUrl: null, assetSize: null, sha256: null, installMode: "none", message: "local_backend_unavailable" },
      startup: this.startup
    };
  }

  private applyRequest(request: DesktopSnapshotRequest): boolean {
    let changed = false;
    if (request.metricWindow && request.metricWindow !== this.metricWindow) {
      this.metricWindow = request.metricWindow;
      changed = true;
    }
    if (request.selectedDeviceId !== undefined && request.selectedDeviceId !== this.selectedDeviceId) {
      this.selectedDeviceId = request.selectedDeviceId;
      changed = true;
    }
    if (request.trafficMode && request.trafficMode !== this.trafficMode) {
      this.trafficMode = request.trafficMode;
      changed = true;
    }
    if (request.trafficAnchor && request.trafficAnchor !== this.trafficAnchor) {
      this.trafficAnchor = request.trafficAnchor;
      changed = true;
    }
    return changed;
  }

  private notify(snapshot: DesktopSnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

function redactBackendState(state: RawAgentBackendState): DesktopAgentBackendState {
  const secret = state.config.connection.secret.trim();
  const scrub = (value?: string) => {
    if (!value || !secret) return value;
    return value.split(secret).join("[redacted]");
  };
  const { secret: _secret, ...connection } = state.config.connection;
  return {
    ...state,
    lastChildLog: scrub(state.lastChildLog),
    lastUploadError: scrub(state.lastUploadError),
    lastIssueDetail: scrub(state.lastIssueDetail),
    config: {
      ...state.config,
      cloudSyncEnabled: state.config.cloudSyncEnabled ?? true,
      dataRecordingEnabled: state.config.dataRecordingEnabled ?? true,
      autoRestartCollector: state.config.autoRestartCollector ?? true,
      autoStartCollector: state.config.autoStartCollector ?? false,
      enabledMetrics: state.config.enabledMetrics ?? [],
      enabledDeviceIds: state.config.enabledDeviceIds ?? {},
      instanceMetricConfig: state.config.instanceMetricConfig ?? {},
      probeSelections: state.config.probeSelections ?? [],
      connection: {
        ...connection,
        secretConfigured: Boolean(secret)
      }
    }
  };
}

function mergeAgentConfig(current: AgentBackendConfig, patch: DesktopConfigPatch): AgentBackendConfig {
  const connectionPatch = patch.connection ?? {};
  return {
    ...current,
    // Renderer patches never carry the Agent credential. The combined Hub
    // connection action is the only user-facing path that synchronizes it.
    connection: {
      ...current.connection,
      serverUrl: connectionPatch.serverUrl ?? current.connection.serverUrl,
      deviceId: connectionPatch.deviceId ?? current.connection.deviceId,
      hostname: connectionPatch.hostname ?? current.connection.hostname
    },
    sampling: { ...current.sampling, ...(patch.sampling ?? {}) },
    enabledMetrics: patch.enabledMetrics ?? current.enabledMetrics,
    enabledDeviceIds: patch.enabledDeviceIds ?? current.enabledDeviceIds,
    instanceMetricConfig: patch.instanceMetricConfig ?? current.instanceMetricConfig,
    probeSelections: patch.probeSelections ?? current.probeSelections,
    cloudSyncEnabled: patch.cloudSyncEnabled ?? current.cloudSyncEnabled,
    dataRecordingEnabled: patch.dataRecordingEnabled ?? current.dataRecordingEnabled,
    autoRestartCollector: patch.autoRestartCollector ?? current.autoRestartCollector,
    autoStartCollector: patch.autoStartCollector ?? current.autoStartCollector
  };
}

function cacheState(snapshot: DesktopSnapshot | null): DesktopSnapshot["cache"] {
  if (!snapshot) return { available: false, savedAt: null, ageSeconds: null };
  const savedAt = snapshot.generatedAt;
  const timestamp = Date.parse(savedAt);
  return {
    available: Number.isFinite(timestamp),
    savedAt,
    ageSeconds: Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000)) : null
  };
}

function currentDesktopVersion(): string {
  return process.env.DSC_VERSION?.trim() || app.getVersion();
}
