import { io, type Socket } from "socket.io-client";
import type {
  ConsoleSnapshot,
  ConsoleSnapshotRequest,
  DeviceRealtimeEvent,
  DeviceSummary,
  MetricWindow,
  MetricsResponse,
  OverviewMetricsResponse,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  UpdateInfo
} from "@dsc/shared";
import type { ConsoleAdapter } from "@dsc/console-ui";
import { WEB_CAPABILITIES, emptyConsoleSnapshot } from "@dsc/console-ui";
import {
  ApiError,
  deleteDevice,
  getMetrics,
  getOverviewMetrics,
  getSession,
  getTrafficCalendar,
  getUpdateInfo,
  listDevices,
  login,
  logout,
  reorderDevices,
  saveFanNote
} from "./api";

import { OfflineSnapshotCache } from "./offline-cache";

export class WebConsoleAdapter implements ConsoleAdapter {
  readonly capabilities = WEB_CAPABILITIES;
  private snapshot: ConsoleSnapshot = emptyConsoleSnapshot();
  private listeners = new Set<(snapshot: ConsoleSnapshot) => void>();
  private socket: Socket | null = null;
  private cache = new OfflineSnapshotCache();
  private sessionScope: string | null = null;
  private generation = 0;
  private sessionGeneration = 0;
  private lastRequest: ConsoleSnapshotRequest = {};
  private removeLifecycle: (() => void) | null = null;

  async establishSession(): Promise<void> {
    const generation = this.generation;
    const sessionGeneration = ++this.sessionGeneration;
    const current = () => generation === this.generation && sessionGeneration === this.sessionGeneration;
    try {
      const session = await getSession();
      if (!current()) throw new Error("session_changed");
      await this.cache.activate(session.issuedAt, current);
      if (!current()) throw new Error("session_changed");
      this.sessionScope = session.issuedAt;
    } catch (error) {
      if (current() && (isUnauthorized(error) || (error instanceof ApiError && error.status === 403))) await this.markSessionExpired();
      throw error;
    }
  }

  async restoreOffline(request: ConsoleSnapshotRequest = {}, current: () => boolean = () => true): Promise<boolean> {
    const generation = this.generation;
    const cached = await this.cache.restore(request);
    if (!cached || generation !== this.generation || !current()) return false;
    this.sessionScope = null;
    this.socket?.close();
    this.socket = null;
    this.snapshot = cached;
    this.notify();
    return true;
  }

  async forgetOfflineData(): Promise<void> {
    await this.markSessionExpired();
  }

  async getSnapshot(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> {
    // Bootstrap has already confirmed connectivity failed. Serve the cached
    // view immediately; refresh, foregrounding and online recovery revalidate.
    if (this.snapshot.source === "cache" && this.sessionScope === null) {
      const generation = ++this.generation;
      const query = request ?? {};
      this.lastRequest = query;
      const cached = await this.cache.restore(query);
      if (generation !== this.generation || this.sessionScope !== null) return this.snapshot;
      if (cached) {
        this.snapshot = cached;
        this.notify();
        return cached;
      }
    }
    return this.loadSnapshot(request);
  }

  async refresh(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> {
    return this.loadSnapshot(request);
  }

  async login(accessKey: string): Promise<ConsoleSnapshot> {
    await this.forgetOfflineData();
    await login({ accessKey });
    await this.establishSession();
    return this.loadSnapshot();
  }

  async logout(): Promise<ConsoleSnapshot> {
    this.socket?.close();
    this.socket = null;
    // Local data is forgotten even if the network cannot complete logout.
    await this.markSessionExpired();
    await logout();
    return this.snapshot;
  }

  async disconnectAgent(): Promise<ConsoleSnapshot> {
    return this.logout();
  }

  async saveHubConnection(_serverUrl: string, accessKey: string): Promise<ConsoleSnapshot> {
    return this.login(accessKey);
  }

  async deleteInstance(deviceId: string): Promise<ConsoleSnapshot> {
    await deleteDevice(deviceId);
    return this.loadSnapshot({ selectedDeviceId: this.snapshot.selectedDeviceId === deviceId ? null : this.snapshot.selectedDeviceId });
  }

  async reorderInstances(deviceIds: string[]): Promise<ConsoleSnapshot> {
    await reorderDevices(deviceIds);
    return this.loadSnapshot({ selectedDeviceId: this.snapshot.selectedDeviceId });
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<ConsoleSnapshot> {
    await saveFanNote(deviceId, fanId, { note });
    return this.loadSnapshot({ selectedDeviceId: deviceId });
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  subscribe(listener: (snapshot: ConsoleSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (!this.removeLifecycle && typeof window !== "undefined") {
      const recover = () => {
        if (document.hidden) { this.socket?.close(); this.socket = null; return; }
        // The visible poller also refreshes on foregrounding; this listener
        // restores connectivity immediately when the network comes back.
        if (navigator.onLine) void this.loadSnapshot(this.lastRequest).catch(() => undefined);
      };
      const disconnect = () => { this.sessionScope = null; this.socket?.close(); this.socket = null; void this.restoreOffline(this.lastRequest); };
      const resetSession = (event: StorageEvent) => {
        if (event.key === "dsc-web-session-reset") void this.markSessionExpired(false);
      };
      window.addEventListener("storage", resetSession);
      window.addEventListener("online", recover);
      window.addEventListener("offline", disconnect);
      const visibility = () => { if (document.hidden) { this.socket?.close(); this.socket = null; } };
      document.addEventListener("visibilitychange", visibility);
      this.removeLifecycle = () => {
        window.removeEventListener("storage", resetSession);
        window.removeEventListener("online", recover);
        window.removeEventListener("offline", disconnect);
        document.removeEventListener("visibilitychange", visibility);
      };
    }
    this.connectSocket();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.removeLifecycle?.();
        this.removeLifecycle = null;
        this.socket?.close();
        this.socket = null;
      }
    };
  }

  private async loadSnapshot(request: ConsoleSnapshotRequest = {}): Promise<ConsoleSnapshot> {
    const generation = ++this.generation;
    this.lastRequest = request;
    try {
      await this.establishSession();
      const scope = this.sessionScope!;
      const devices = await listDevices();
      const selectedDeviceId = request.selectedDeviceId !== undefined
        ? request.selectedDeviceId
        : this.snapshot.selectedDeviceId && devices.some((device) => device.deviceId === this.snapshot.selectedDeviceId)
          ? this.snapshot.selectedDeviceId
          : devices[0]?.deviceId ?? null;
      const metricWindow: MetricWindow = request.metricWindow ?? "5m";
      const trafficMode: TrafficCalendarMode = request.trafficMode ?? "day";

      const [metrics, overviewMetrics, update, trafficCalendar] = await Promise.all([
        selectedDeviceId ? getMetrics(selectedDeviceId, metricWindow).catch((error) => optionalWebRequest<MetricsResponse>(error)) : Promise.resolve(null),
        getOverviewMetrics(metricWindow).catch((error) => optionalWebRequest<OverviewMetricsResponse>(error)),
        getUpdateInfo("web").catch((error) => optionalWebRequest<UpdateInfo>(error)),
        selectedDeviceId
          ? getTrafficCalendar(selectedDeviceId, trafficMode, request.trafficAnchor ?? new Date().toISOString()).catch((error) => optionalWebRequest<TrafficCalendarResponse>(error))
          : Promise.resolve(null)
      ]);

      const nextSnapshot: ConsoleSnapshot = {
        generatedAt: dataTimestamp(devices, metrics),
        source: "live",
        cache: { available: false, savedAt: null, ageSeconds: null },
        session: { authenticated: true, accessKeyConfigured: true },
        localBackend: null,
        devices,
        selectedDeviceId,
        metrics,
        overviewMetrics,
        trafficCalendar,
        update,
        startup: { openAtLogin: false, startMinimized: false }
      };
      // A slow previous selection cannot replace the latest intent, and a
      // request started before logout cannot repopulate a cleared cache.
      if (generation !== this.generation || scope !== this.sessionScope) return this.snapshot;
      this.snapshot = nextSnapshot;
      const cached = await this.cache.save(scope, nextSnapshot, request, () => generation === this.generation && scope === this.sessionScope);
      if (generation !== this.generation || scope !== this.sessionScope) return this.snapshot;
      this.snapshot = { ...nextSnapshot, cache: { available: cached, savedAt: cached ? new Date().toISOString() : null, ageSeconds: cached ? 0 : null } };
      this.notify();
      if (this.listeners.size) this.connectSocket();
      return this.snapshot;
    } catch (error) {
      if (generation !== this.generation) {
        if ((isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) && this.snapshot.source === "empty" && !this.snapshot.session.authenticated) throw error;
        return this.snapshot;
      }
      if (isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) { await this.markSessionExpired(); throw error; }
      this.sessionScope = null;
      const cached = await this.cache.restore(request);
      if (generation !== this.generation) return this.snapshot;
      if (cached) {
        this.socket?.close(); this.socket = null;
        this.snapshot = cached;
        this.notify();
        return cached;
      }
      throw error;
    }
  }

  private async markSessionExpired(broadcast = true): Promise<void> {
    const generation = ++this.generation;
    this.sessionScope = null;
    await this.cache.clear();
    if (generation !== this.generation) return;
    if (broadcast && typeof window !== "undefined") {
      try { localStorage.setItem("dsc-web-session-reset", `${Date.now()}:${Math.random()}`); } catch { /* Storage can be denied. */ }
    }
    this.socket?.close();
    this.socket = null;
    this.snapshot = { ...emptyConsoleSnapshot(), generatedAt: new Date().toISOString() };
    this.notify();
  }

  private connectSocket(): void {
    if (this.socket || typeof window === "undefined" || document.hidden || !this.listeners.size || !this.sessionScope || this.snapshot.source !== "live" || !this.snapshot.session.authenticated) return;
    this.socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true
    });
    this.socket.on("device:update", (event: DeviceRealtimeEvent) => {
      if (this.snapshot.source !== "live" || !this.sessionScope) return;
      if (event.removed) {
        const devices = this.snapshot.devices.filter((device) => device.deviceId !== event.deviceId);
        this.snapshot = { ...this.snapshot, generatedAt: dataTimestamp(devices, this.snapshot.metrics), devices };
        this.notify();
        if (this.snapshot.selectedDeviceId === event.deviceId) {
          void this.loadSnapshot().catch(() => { /* The visible poller retries failed reads. */ });
        }
        return;
      }
      const devices = upsertDevice(this.snapshot.devices, event.summary);
      this.snapshot = { ...this.snapshot, generatedAt: dataTimestamp(devices, this.snapshot.metrics), devices };
      this.notify();
      // The event already carries the new device summary. History/calendar
      // reads belong to the visibility-aware UI poller, not every agent push.
      // This also preserves the user's selected history window.
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function isUnauthorized(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

function optionalWebRequest<T>(error: unknown): T | null {
  if (isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) throw error;
  return null;
}

function upsertDevice(devices: DeviceSummary[], next: DeviceSummary): DeviceSummary[] {
  const index = devices.findIndex((device) => device.deviceId === next.deviceId);
  if (index < 0) return [...devices, next];
  return devices.map((device, itemIndex) => itemIndex === index ? { ...device, ...next, sortOrder: next.sortOrder ?? device.sortOrder } : device);
}

/**
 * When the data on screen was last true, not when we looked at it.
 *
 * `generatedAt` used to be `new Date()` on every read, so a poll that came back
 * with the same minutes-old device rows still announced "同步于 <现在>", and the
 * only way to notice a fleet that had stopped reporting was to open each device.
 * `/api/instances` carries no envelope timestamp, so the freshest fact the hub
 * does give is each device's own `lastSeenAt`, plus the selected device's metric
 * report time and the end of the sample range it served. With nothing usable —
 * an empty fleet, or a payload without times — the moment of the read is the
 * honest answer, and the pages label that as "还没有设备接入" anyway.
 */
function dataTimestamp(devices: DeviceSummary[], metrics: MetricsResponse | null): string {
  let newest = 0;
  for (const candidate of [...devices.map((device) => device.lastSeenAt), metrics?.lastSeenAt ?? null, metrics?.rangeEnd ?? null]) {
    const value = candidate ? Date.parse(candidate) : Number.NaN;
    if (Number.isFinite(value) && value > newest) newest = value;
  }
  return newest > 0 ? new Date(newest).toISOString() : new Date().toISOString();
}

export const webConsoleAdapter = new WebConsoleAdapter();
