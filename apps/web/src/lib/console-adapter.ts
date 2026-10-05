import { io, type Socket } from "socket.io-client";
import type {
  ConsoleSnapshot,
  ConsoleSnapshotInclude,
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
// The adapter contract module directly, not the UI barrel: the transport has no
// business loading React components, and it keeps this file runnable under
// `node --test`.
import type { ConsoleAdapter } from "@dsc/console-ui/services/adapter";
import { WEB_CAPABILITIES, emptyConsoleSnapshot } from "@dsc/console-ui/services/adapter";
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
} from "./api.ts";

import { OfflineSnapshotCache } from "./offline-cache.ts";

/**
 * Request budget.
 *
 * A poll used to cost six requests — session, device list, the selected
 * device's history, the overview history, update info and the traffic
 * calendar — every 10 s on every page, with the session check and the device
 * list run in series before the rest. The overview paid for a device history it
 * never drew and the device page for an overview it never showed.
 *
 * Now a view names what it reads (`request.include`), resources that change
 * slowly are reused inside a TTL, and the session is re-confirmed only when it
 * has gone unchecked for a while (any 401 on a data read still expires it at
 * once).
 */
const SESSION_RECHECK_MS = 60_000;
const UPDATE_TTL_MS = 10 * 60_000;
const UPDATE_FAILURE_TTL_MS = 60_000;
const CALENDAR_TTL_MS = 60_000;
/** The offline copy of an unchanged view is rewritten at most this often. */
const CACHE_SAVE_INTERVAL_MS = 30_000;
/** Agent pushes refresh the open device's charts no faster than this. */
const METRICS_PUSH_MIN_INTERVAL_MS = 5_000;

const INCLUDE_EVERYTHING: Required<ConsoleSnapshotInclude> = { deviceMetrics: true, overviewMetrics: true, trafficCalendar: true };

export function resolveInclude(include: ConsoleSnapshotInclude | undefined): Required<ConsoleSnapshotInclude> {
  if (!include) return INCLUDE_EVERYTHING;
  return { deviceMetrics: include.deviceMetrics === true, overviewMetrics: include.overviewMetrics === true, trafficCalendar: include.trafficCalendar === true };
}

interface TimedValue<T> { value: T; fetchedAt: number; ttl: number }

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
  private sessionCheckedAt = 0;
  private updateInfo: TimedValue<UpdateInfo | null> | null = null;
  private calendars = new Map<string, TimedValue<TrafficCalendarResponse | null>>();
  private cacheSavedAt = new Map<string, number>();
  private metricsPullTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMetricsPull = 0;
  /** Injectable clock so request budgeting can be tested without real waits. */
  now: () => number = () => Date.now();

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
      this.sessionCheckedAt = this.now();
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
        this.cancelMetricsPull();
      }
    };
  }

  /** Re-confirm the session only when it has gone unchecked for a while. */
  private async ensureSession(): Promise<void> {
    if (this.sessionScope && this.now() - this.sessionCheckedAt < SESSION_RECHECK_MS) return;
    await this.establishSession();
  }

  private async readUpdateInfo(): Promise<UpdateInfo | null> {
    const cached = this.updateInfo;
    if (cached && this.now() - cached.fetchedAt < cached.ttl) return cached.value;
    const value = await getUpdateInfo("web").catch((error) => optionalWebRequest<UpdateInfo>(error));
    this.updateInfo = { value, fetchedAt: this.now(), ttl: value ? UPDATE_TTL_MS : UPDATE_FAILURE_TTL_MS };
    return value;
  }

  private async readTrafficCalendar(deviceId: string, mode: TrafficCalendarMode, anchor: string): Promise<TrafficCalendarResponse | null> {
    // The calendar is bucketed by day, so the anchor's date is the identity.
    const key = `${deviceId}\u0000${mode}\u0000${anchor.slice(0, 10)}`;
    const cached = this.calendars.get(key);
    if (cached && this.now() - cached.fetchedAt < cached.ttl) return cached.value;
    const value = await getTrafficCalendar(deviceId, mode, anchor).catch((error) => optionalWebRequest<TrafficCalendarResponse>(error));
    this.calendars.set(key, { value, fetchedAt: this.now(), ttl: CALENDAR_TTL_MS });
    if (this.calendars.size > 24) this.calendars.delete(this.calendars.keys().next().value!);
    return value;
  }

  private async loadSnapshot(request: ConsoleSnapshotRequest = {}): Promise<ConsoleSnapshot> {
    const generation = ++this.generation;
    this.lastRequest = request;
    try {
      await this.ensureSession();
      const scope = this.sessionScope!;
      const include = resolveInclude(request.include);
      const metricWindow: MetricWindow = request.metricWindow ?? "5m";
      const trafficMode: TrafficCalendarMode = request.trafficMode ?? "day";
      const devicesRead = listDevices();
      // A view that names its device starts the history read alongside the
      // device list instead of waiting for it.
      const namedDeviceId = typeof request.selectedDeviceId === "string" ? request.selectedDeviceId : null;
      const earlyMetrics = namedDeviceId && include.deviceMetrics
        ? getMetrics(namedDeviceId, metricWindow).catch((error) => optionalWebRequest<MetricsResponse>(error))
        : null;
      // Settle the early read even if the device list fails first, so it never
      // surfaces as an unhandled rejection.
      earlyMetrics?.catch(() => undefined);
      const devices = await devicesRead;
      const selectedDeviceId = request.selectedDeviceId !== undefined
        ? request.selectedDeviceId
        : this.snapshot.selectedDeviceId && devices.some((device) => device.deviceId === this.snapshot.selectedDeviceId)
          ? this.snapshot.selectedDeviceId
          : devices[0]?.deviceId ?? null;
      const previous = this.snapshot;

      const [metrics, overviewMetrics, update, trafficCalendar] = await Promise.all([
        include.deviceMetrics && selectedDeviceId
          ? earlyMetrics ?? getMetrics(selectedDeviceId, metricWindow).catch((error) => optionalWebRequest<MetricsResponse>(error))
          // Views that do not draw it keep the last payload; pages match it by
          // device and window before using it.
          : Promise.resolve(previous.metrics),
        include.overviewMetrics
          ? getOverviewMetrics(metricWindow).catch((error) => optionalWebRequest<OverviewMetricsResponse>(error))
          : Promise.resolve(previous.overviewMetrics),
        this.readUpdateInfo(),
        include.trafficCalendar && selectedDeviceId
          ? this.readTrafficCalendar(selectedDeviceId, trafficMode, request.trafficAnchor ?? new Date(this.now()).toISOString())
          : Promise.resolve(previous.trafficCalendar)
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
      // Serialising the offline copy measures the whole record (up to 4 MB) on
      // the main thread. A view whose copy was written moments ago keeps it.
      const saveKey = JSON.stringify([selectedDeviceId, metricWindow, include, trafficMode, request.trafficAnchor?.slice(0, 10) ?? ""]);
      const lastSaved = this.cacheSavedAt.get(saveKey) ?? 0;
      let cacheState = previous.cache;
      if (this.now() - lastSaved >= CACHE_SAVE_INTERVAL_MS || !previous.cache.available) {
        const cached = await this.cache.save(scope, nextSnapshot, request, () => generation === this.generation && scope === this.sessionScope);
        if (generation !== this.generation || scope !== this.sessionScope) return this.snapshot;
        if (cached) this.cacheSavedAt.set(saveKey, this.now());
        cacheState = { available: cached, savedAt: cached ? new Date(this.now()).toISOString() : null, ageSeconds: cached ? 0 : null };
      } else if (cacheState.savedAt) {
        cacheState = { ...cacheState, ageSeconds: Math.max(0, Math.floor((this.now() - Date.parse(cacheState.savedAt)) / 1000)) };
      }
      this.snapshot = { ...nextSnapshot, cache: cacheState };
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
    this.sessionCheckedAt = 0;
    this.updateInfo = null;
    this.calendars.clear();
    this.cacheSavedAt.clear();
    this.cancelMetricsPull();
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
      // A push for the device on screen means its history has a new sample.
      // Re-read just that history (throttled), so the open charts follow the
      // Agent instead of waiting for the next full poll. Other devices only
      // need the summary the event already carried.
      if (event.deviceId === this.snapshot.selectedDeviceId && resolveInclude(this.lastRequest.include).deviceMetrics) {
        this.scheduleMetricsPull(event.deviceId);
      }
    });
  }

  private scheduleMetricsPull(deviceId: string): void {
    if (this.metricsPullTimer) return;
    const wait = Math.max(0, this.lastMetricsPull + METRICS_PUSH_MIN_INTERVAL_MS - this.now());
    this.metricsPullTimer = setTimeout(() => {
      this.metricsPullTimer = null;
      void this.pullSelectedMetrics(deviceId);
    }, wait);
  }

  private cancelMetricsPull(): void {
    if (this.metricsPullTimer) clearTimeout(this.metricsPullTimer);
    this.metricsPullTimer = null;
  }

  private async pullSelectedMetrics(deviceId: string): Promise<void> {
    const generation = this.generation;
    const scope = this.sessionScope;
    const metricWindow: MetricWindow = this.lastRequest.metricWindow ?? "5m";
    if (!scope || this.snapshot.source !== "live" || this.snapshot.selectedDeviceId !== deviceId) return;
    this.lastMetricsPull = this.now();
    try {
      const metrics = await getMetrics(deviceId, metricWindow);
      // A full read that started meanwhile owns the snapshot; so does a change
      // of device, window or session.
      if (generation !== this.generation || scope !== this.sessionScope || this.snapshot.selectedDeviceId !== deviceId
        || (this.lastRequest.metricWindow ?? "5m") !== metricWindow) return;
      this.snapshot = { ...this.snapshot, metrics, generatedAt: dataTimestamp(this.snapshot.devices, metrics) };
      this.notify();
    } catch (error) {
      if (isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) await this.markSessionExpired();
      // Anything else is left to the visible poller.
    }
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
