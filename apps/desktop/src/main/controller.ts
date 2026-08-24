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
  TrafficCalendarMode,
  WidgetLayoutRequest,
  WidgetLayoutSaveRequest,
  WidgetLayoutSync
} from "@dsc/shared";
import { AgentManager } from "./agent-manager.js";
import { readJsonFile, writeJsonAtomically } from "./atomic-json.js";
import { DesktopCacheStore } from "./cache-store.js";
import { credentialFilePath, HubClient } from "./hub-client.js";
import { LocalConfigStore } from "./local-config.js";
import type { AgentBackendConfig, RawAgentBackendState } from "./types.js";

const DEFAULT_METRIC_WINDOW: MetricWindow = "5m";
const DEFAULT_TRAFFIC_MODE: TrafficCalendarMode = "day";
const TRAFFIC_CALENDAR_CACHE_TTL_MS = 60_000;

type CachedTrafficCalendar = {
  key: string;
  value: NonNullable<DesktopSnapshot["trafficCalendar"]>;
  savedAt: number;
};

export class DesktopController {
  readonly bridge: Omit<DesktopRendererBridge, "subscribe" | "windowMinimize" | "windowToggleMaximize" | "windowDragStart" | "windowDragMove" | "windowDragEnd" | "windowClose">;
  private readonly agent: AgentManager;
  private readonly hub: HubClient;
  private readonly cache: DesktopCacheStore;
  private readonly localConfig: LocalConfigStore;
  private readonly listeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private currentSnapshot: DesktopSnapshot | null = null;
  private refreshInFlight: Promise<DesktopSnapshot> | null = null;
  private queuedRefreshRequest: DesktopSnapshotRequest | null = null;
  private metricWindow: MetricWindow = DEFAULT_METRIC_WINDOW;
  private selectedDeviceId: string | null = null;
  private trafficMode: TrafficCalendarMode = DEFAULT_TRAFFIC_MODE;
  private trafficAnchor = new Date().toISOString();
  private trafficCalendarCache: CachedTrafficCalendar | null = null;
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
      disconnectAgent: () => this.disconnectAgent(),
      cloudPush: () => this.cloudPush(),
      getWidgetLayout: (request: WidgetLayoutRequest) => this.getWidgetLayout(request),
      saveWidgetLayout: (request: WidgetLayoutSaveRequest) => this.saveWidgetLayout(request),
      saveFanNote: (deviceId: string, fanId: string, note: string) => this.saveFanNote(deviceId, fanId, note),
      deleteInstance: (deviceId: string) => this.deleteInstance(deviceId),
      reorderInstances: (deviceIds: string[]) => this.reorderInstances(deviceIds),
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
    const requestChanged = this.hasRequestChanges(request);
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
    if (this.refreshInFlight) {
      if (this.hasRequestChanges(request)) {
        this.queuedRefreshRequest = mergeSnapshotRequests(this.queuedRefreshRequest, request);
      }
      return this.refreshInFlight;
    }
    this.queuedRefreshRequest = mergeSnapshotRequests(this.queuedRefreshRequest, request);

    const refresh = this.drainRefreshQueue();
    this.refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    }
  }

  private async drainRefreshQueue(): Promise<DesktopSnapshot> {
    let snapshot = this.currentSnapshot;
    while (this.queuedRefreshRequest) {
      const request = this.queuedRefreshRequest;
      this.queuedRefreshRequest = null;
      snapshot = await this.refreshOnce(request);
    }
    return snapshot ?? this.emptySnapshot();
  }

  private async refreshOnce(request: DesktopSnapshotRequest): Promise<DesktopSnapshot> {
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
    if (nextConfig.cloudSyncEnabled && (patch.enabledDeviceIds || patch.enabledMetrics || patch.probeSelections || patch.instanceMetricConfig)) {
      try {
        await this.agent.cloudPush();
      } catch {
        // Cloud push is best-effort when offline or disconnected
      }
    }
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

  async disconnectAgent(): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    await this.agent.control("stop");
    const nextConfig = mergeAgentConfig(rawState.config, {
      cloudSyncEnabled: false
    });
    nextConfig.connection.secret = "";
    await this.agent.updateConfig(nextConfig);
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

  async getWidgetLayout(request: WidgetLayoutRequest): Promise<WidgetLayoutSync> {
    const rawState = await this.agent.start();
    if (!this.hub.setServerUrl(rawState.config.connection.serverUrl)) throw new Error("hub_server_url_missing");
    return this.hub.getWidgetLayout(request);
  }

  async saveWidgetLayout(request: WidgetLayoutSaveRequest): Promise<WidgetLayoutSync> {
    const rawState = await this.agent.start();
    if (!this.hub.setServerUrl(rawState.config.connection.serverUrl)) throw new Error("hub_server_url_missing");
    return this.hub.saveWidgetLayout(request);
  }

  async deleteInstance(deviceId: string): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    if (!this.hub.setServerUrl(rawState.config.connection.serverUrl)) throw new Error("hub_server_url_missing");
    await this.hub.deleteDevice(deviceId);
    return this.refresh({ selectedDeviceId: this.selectedDeviceId === deviceId ? null : this.selectedDeviceId });
  }

  async reorderInstances(deviceIds: string[]): Promise<DesktopSnapshot> {
    const rawState = await this.agent.start();
    if (!this.hub.setServerUrl(rawState.config.connection.serverUrl)) throw new Error("hub_server_url_missing");
    await this.hub.reorderDevices(deviceIds);
    return this.refresh({ selectedDeviceId: this.selectedDeviceId });
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
    let devices = [] as DesktopSnapshot["devices"];
    // Device pages are hub-backed. Never synthesize a local device entry when
    // the hub is unavailable or the agent has not uploaded its latest data.
    let selectedDeviceId = this.selectedDeviceId;
    let metrics: DesktopSnapshot["metrics"] = null;
    let overviewMetrics: DesktopSnapshot["overviewMetrics"] = null;
    let trafficCalendar: DesktopSnapshot["trafficCalendar"] = null;
    let update: DesktopSnapshot["update"] = null;
    let authenticated = false;

    try {
      devices = await this.hub.listDevices();
      authenticated = true;
      if (!selectedDeviceId && devices.length > 0) selectedDeviceId = devices[0].deviceId;
    } catch {
      // The caller may fall back to the same cached hub snapshot used for any
      // other device, but local agent telemetry must never become a device page.
    }

    if (selectedDeviceId && this.hub.isConfigured) {
      try {
        metrics = await this.hub.getMetrics(selectedDeviceId, this.metricWindow);
      } catch {
        metrics = null;
      }
      trafficCalendar = await this.readTrafficCalendar(selectedDeviceId);
    }

    if (this.hub.isConfigured) {
      try {
        // Keep overview lines on the same time window as the device page;
        // otherwise the shared toolbar would claim to change a range that
        // only affected the detail charts.
        overviewMetrics = await this.hub.getOverviewMetrics(this.metricWindow);
      } catch {
        overviewMetrics = null;
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
      overviewMetrics,
      trafficCalendar,
      update,
      authenticated
    };
  }

  private async readTrafficCalendar(deviceId: string): Promise<DesktopSnapshot["trafficCalendar"]> {
    const key = [deviceId, this.trafficMode, this.trafficAnchor].join("\u001f");
    const cached = this.trafficCalendarCache;
    if (cached?.key === key && Date.now() - cached.savedAt < TRAFFIC_CALENDAR_CACHE_TTL_MS) {
      return cached.value;
    }

    try {
      const value = await this.hub.getTrafficCalendar(deviceId, this.trafficMode, this.trafficAnchor);
      this.trafficCalendarCache = { key, value, savedAt: Date.now() };
      return value;
    } catch {
      return cached?.key === key ? cached.value : null;
    }
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
      overviewMetrics: usingCachedRemote ? cachedRemote?.overviewMetrics ?? null : live.overviewMetrics,
      trafficCalendar: usingCachedRemote ? cachedRemote?.trafficCalendar ?? null : live.trafficCalendar,
      update: usingCachedRemote ? cachedRemote?.update ?? null : live.update,
      startup: this.startup
    };
    return snapshot;
  }

  private asCachedSnapshot(cached: DesktopSnapshot, error?: unknown): DesktopSnapshot {
    return {
      ...cached,
      // Keep the timestamp of the last successful live snapshot. The renderer
      // uses cache.savedAt for the cache age and must not confuse the moment
      // this fallback was rendered with the moment telemetry was collected.
      generatedAt: cached.generatedAt,
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
      overviewMetrics: null,
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
      this.trafficCalendarCache = null;
      changed = true;
    }
    if (request.trafficMode && request.trafficMode !== this.trafficMode) {
      this.trafficMode = request.trafficMode;
      this.trafficCalendarCache = null;
      changed = true;
    }
    if (request.trafficAnchor && request.trafficAnchor !== this.trafficAnchor) {
      this.trafficAnchor = request.trafficAnchor;
      this.trafficCalendarCache = null;
      changed = true;
    }
    return changed;
  }

  private hasRequestChanges(request: DesktopSnapshotRequest): boolean {
    return (request.metricWindow !== undefined && request.metricWindow !== this.metricWindow)
      || (request.selectedDeviceId !== undefined && request.selectedDeviceId !== this.selectedDeviceId)
      || (request.trafficMode !== undefined && request.trafficMode !== this.trafficMode)
      || (request.trafficAnchor !== undefined && request.trafficAnchor !== this.trafficAnchor);
  }

  private notify(snapshot: DesktopSnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

function mergeSnapshotRequests(
  current: DesktopSnapshotRequest | null,
  next: DesktopSnapshotRequest
): DesktopSnapshotRequest {
  const merged: DesktopSnapshotRequest = { ...(current ?? {}) };
  if (next.metricWindow !== undefined) merged.metricWindow = next.metricWindow;
  if (next.selectedDeviceId !== undefined) merged.selectedDeviceId = next.selectedDeviceId;
  if (next.trafficMode !== undefined) merged.trafficMode = next.trafficMode;
  if (next.trafficAnchor !== undefined) merged.trafficAnchor = next.trafficAnchor;
  if (next.preferCache !== undefined) merged.preferCache = next.preferCache;
  return merged;
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
    lastCloudSyncError: scrub(state.lastCloudSyncError),
    lastIssueDetail: scrub(state.lastIssueDetail),
    config: {
      ...state.config,
      configVersion: state.config.configVersion ?? 1,
      cloudSyncEnabled: state.config.cloudSyncEnabled ?? true,
      dataRecordingEnabled: state.config.dataRecordingEnabled ?? true,
      autoRestartCollector: state.config.autoRestartCollector ?? true,
      autoStartCollector: state.config.autoStartCollector ?? false,
      enabledMetrics: state.config.enabledMetrics ?? [],
      enabledDeviceIds: state.config.enabledDeviceIds ?? {},
      instanceMetricConfig: state.config.instanceMetricConfig ?? {},
      probeSelections: state.config.probeSelections ?? [],
      virtualization: state.config.virtualization,
      connection: {
        ...connection,
        secretConfigured: Boolean(secret)
      }
    },
    // Older bundled Agent builds may omit these collections or return null
    // while hardware detection has not run yet. Keep the renderer contract
    // stable so settings never fail during the first paint.
    supportedProbePlans: Array.isArray(state.supportedProbePlans)
      ? state.supportedProbePlans.map((plan) => ({
        ...plan,
        providers: Array.isArray(plan.providers) ? plan.providers : []
      }))
      : [],
    detectedTargets: Array.isArray(state.detectedTargets)
      ? state.detectedTargets.map((group) => ({
        ...group,
        instances: Array.isArray(group.instances) ? group.instances : []
      }))
      : [],
    temperatureSources: Array.isArray(state.temperatureSources) ? state.temperatureSources : [],
    temperatureSensorBackends: Array.isArray(state.temperatureSensorBackends) ? state.temperatureSensorBackends : [],
    temperatureProbeError: scrub(state.temperatureProbeError)
  };
}

function mergeAgentConfig(current: AgentBackendConfig, patch: DesktopConfigPatch): AgentBackendConfig {
  const connectionPatch = patch.connection ?? {};
  return {
    ...current,
    configVersion: patch.configVersion ?? current.configVersion ?? 1,
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
    virtualization: patch.virtualization ?? current.virtualization,
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
