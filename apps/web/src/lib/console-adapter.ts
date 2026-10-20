import { io, type Socket } from "socket.io-client";
import type {
  ConsoleSnapshot,
  ConsoleLivePort,
  LiveConnection,
  LiveSnapshot,
  LiveTopic,
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
import { WEB_CAPABILITIES, emptyConsoleSnapshot, networkPolicy, pollDelay } from "@dsc/console-ui/services/adapter";
import {
  ApiError,
  apiFetch,
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
import { ReadQueue } from "./read-queue.ts";

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
  readonly live: ConsoleLivePort = {
    getLiveConnection: (deviceId) => this.liveRequest<LiveConnection>(deviceId),
    readLive: <T extends LiveTopic>(deviceId: string, topic: T) => this.liveRequest<LiveSnapshot<T>>(deviceId, topic),
    resetLiveCredentials: async (deviceId: string) => {
      await this.liveRequest<{ ok: boolean }>(deviceId, undefined, { method: "POST", body: "{}" }, "/reset");
    }
  };

  private async liveRequest<T>(deviceId: string, topic?: LiveTopic, init?: RequestInit, suffix = ""): Promise<T> {
    if (!this.sessionScope || this.snapshot.source !== "live") throw new Error("live_session_required");
    const scope = this.sessionScope;
    const sessionGeneration = this.sessionGeneration;
    const current = () => scope === this.sessionScope && sessionGeneration === this.sessionGeneration;
    try {
      const result = await apiFetch<T>(`/api/devices/${encodeURIComponent(deviceId)}/live${topic ? `/${topic}` : suffix}`, init);
      if (!current()) throw new Error("session_changed");
      return result;
    } catch (error) {
      if (current() && isUnauthorized(error)) await this.markSessionExpired();
      if (error instanceof ApiError && error.code) throw new Error(error.code);
      throw error;
    }
  }

  readonly capabilities = WEB_CAPABILITIES;
  private snapshot: ConsoleSnapshot = emptyConsoleSnapshot();
  private listeners = new Set<(snapshot: ConsoleSnapshot) => void>();
  private socket: Socket | null = null;
  private cache = new OfflineSnapshotCache();
  private sessionScope: string | null = null;
  private identityScope: string | null = null;
  private generation = 0;
  private sessionGeneration = 0;
  private lastRequest: ConsoleSnapshotRequest = {};
  private removeLifecycle: (() => void) | null = null;
  private sessionCheckedAt = 0;
  private sessionInFlight: Promise<void> | null = null;
  private cacheSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private updateInfo: TimedValue<UpdateInfo | null> | null = null;
  private calendars = new Map<string, TimedValue<TrafficCalendarResponse | null>>();
  private cacheSavedAt = new Map<string, number>();
  private metricsPullTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMetricsPull = 0;
  private reads = new ReadQueue();
  private snapshotAbort = new AbortController();
  private identityAbort = new AbortController();
  private durationMs = 0;
  private failures = 0;
  private optionalFailures = 0;
  /** Injectable clock so request budgeting can be tested without real waits. */
  now: () => number = () => Date.now();

  cancelSnapshot(): void {
    ++this.generation;
    this.snapshotAbort.abort(new Error("request_superseded"));
    this.identityAbort.abort(new Error("request_superseded"));
    this.identityAbort = new AbortController();
    this.cancelMetricsPull();
  }

  private policy() {
    const hints = typeof navigator === "undefined" ? {} : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; rtt?: number; downlink?: number } }).connection;
    return networkPolicy(this.lastRequest.networkMode ?? "auto", this.durationMs, hints);
  }

  getRefreshDelay(baseMs: number): number {
    return pollDelay(baseMs, this.policy().minimumPollMs, Math.max(this.failures, this.optionalFailures));
  }

  private metricsRead(deviceId: string, metricWindow: MetricWindow, signal: AbortSignal) {
    const pointBudget = this.policy().pointBudget;
    return this.reads.run(`metrics:${deviceId}:${metricWindow}:${pointBudget}`, () => getMetrics(deviceId, metricWindow, { signal }, pointBudget), signal);
  }

  establishSession(supersede = false): Promise<void> {
    if (!supersede && this.sessionInFlight) return this.sessionInFlight;
    const operation = this.checkSession();
    this.sessionInFlight = operation;
    void operation.finally(() => {
      if (this.sessionInFlight === operation) this.sessionInFlight = null;
    }).catch(() => undefined);
    return operation;
  }

  private async checkSession(): Promise<void> {
    const sessionGeneration = ++this.sessionGeneration;
    const current = () => sessionGeneration === this.sessionGeneration;
    try {
      const session = await getSession();
      if (!current()) throw new Error("session_changed");
      const changedCacheScope = await this.cache.activate(session.issuedAt, current);
      if (!current()) throw new Error("session_changed");
      if (changedCacheScope || (this.identityScope && this.identityScope !== session.issuedAt)) {
        this.identityAbort.abort(new Error("session_changed"));
        this.identityAbort = new AbortController();
        this.updateInfo = null;
        this.calendars.clear();
        this.cacheSavedAt.clear();
        this.snapshot = { ...emptyConsoleSnapshot(), session: { authenticated: true, accessKeyConfigured: true } };
        this.socket?.close();
        this.socket = null;
        this.notify();
      }
      this.sessionScope = session.issuedAt;
      this.identityScope = session.issuedAt;
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
    return this.loadSnapshot(request, true);
  }

  async refresh(request?: ConsoleSnapshotRequest): Promise<ConsoleSnapshot> {
    return this.loadSnapshot(request);
  }

  resumeCachedSession(): void {
    if (this.snapshot.source === "cache" && this.sessionScope && this.listeners.size) {
      void this.loadSnapshot(this.lastRequest, true).catch(() => undefined);
    }
  }

  async login(accessKey: string): Promise<ConsoleSnapshot> {
    await this.forgetOfflineData();
    await login({ accessKey });
    await this.establishSession();
    return this.loadSnapshot({}, true);
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
    return this.loadSnapshot({ ...this.lastRequest, selectedDeviceId: this.snapshot.selectedDeviceId === deviceId ? null : this.snapshot.selectedDeviceId });
  }

  async reorderInstances(deviceIds: string[]): Promise<ConsoleSnapshot> {
    await reorderDevices(deviceIds);
    return this.loadSnapshot({ ...this.lastRequest, selectedDeviceId: this.snapshot.selectedDeviceId });
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<ConsoleSnapshot> {
    await saveFanNote(deviceId, fanId, { note });
    return this.loadSnapshot({ ...this.lastRequest, selectedDeviceId: deviceId });
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
        if (navigator.onLine) void this.loadSnapshot({ ...this.lastRequest, background: false }, false, true).catch(() => undefined);
      };
      const disconnect = () => { this.cancelSnapshot(); this.sessionScope = null; this.socket?.close(); this.socket = null; void this.restoreOffline(this.lastRequest); };
      const resetSession = (event: StorageEvent) => {
        if (event.key === "dsc-web-session-reset") void this.markSessionExpired(false);
      };
      window.addEventListener("storage", resetSession);
      window.addEventListener("online", recover);
      window.addEventListener("offline", disconnect);
      const visibility = () => { if (document.hidden) { this.cancelSnapshot(); this.socket?.close(); this.socket = null; } };
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
        this.cancelSnapshot();
        this.removeLifecycle?.();
        this.removeLifecycle = null;
        this.socket?.close();
        this.socket = null;
        this.cancelMetricsPull();
      }
    };
  }

  /**
   * Background polls re-confirm the session only when it has gone unchecked for
   * a while; anything the user or the network triggered confirms it every time.
   */
  private async ensureSession(background: boolean, supersede = false): Promise<void> {
    if (!supersede && background && this.sessionScope && this.now() - this.sessionCheckedAt < SESSION_RECHECK_MS) return;
    // An explicit online transition is a new connectivity epoch, not another
    // bootstrap consumer. A pre-recovery 401 must not invalidate its session.
    await this.establishSession(supersede);
  }

  private async readUpdateInfo(): Promise<UpdateInfo | null> {
    const cached = this.updateInfo;
    if (cached && this.now() - cached.fetchedAt < cached.ttl) return cached.value;
    const sessionGeneration = this.sessionGeneration;
    const signal = this.identityAbort.signal;
    const value = await this.reads.run(`update:${this.sessionScope}`, () => getUpdateInfo("web", { signal }), signal, 3)
      .catch((error) => { if (signal.aborted) throw error; return optionalWebRequest<UpdateInfo>(error); });
    if (sessionGeneration === this.sessionGeneration) this.updateInfo = { value, fetchedAt: this.now(), ttl: value ? UPDATE_TTL_MS : UPDATE_FAILURE_TTL_MS };
    return value;
  }

  private async readTrafficCalendar(deviceId: string, mode: TrafficCalendarMode, anchor: string, signal: AbortSignal): Promise<TrafficCalendarResponse | null> {
    // The calendar is bucketed by day, so the anchor's date is the identity.
    const key = `${deviceId}\u0000${mode}\u0000${anchor.slice(0, 10)}`;
    const cached = this.calendars.get(key);
    if (cached && this.now() - cached.fetchedAt < cached.ttl) return cached.value;
    const sessionGeneration = this.sessionGeneration;
    const value = await this.reads.run(`calendar:${key}`, () => getTrafficCalendar(deviceId, mode, anchor, undefined, { signal }), signal, 2);
    if (sessionGeneration !== this.sessionGeneration) return value;
    this.calendars.set(key, { value, fetchedAt: this.now(), ttl: CALENDAR_TTL_MS });
    if (this.calendars.size > 24) this.calendars.delete(this.calendars.keys().next().value!);
    return value;
  }

  private async loadSnapshot(request: ConsoleSnapshotRequest = {}, reuseSession = false, supersedeSession = false): Promise<ConsoleSnapshot> {
    this.cancelSnapshot();
    this.snapshotAbort = new AbortController();
    const signal = this.snapshotAbort.signal;
    const generation = ++this.generation;
    this.lastRequest = request;
    this.reads.setLimit(this.policy().concurrency);
    try {
      await this.ensureSession(reuseSession || request.background === true, supersedeSession);
      if (generation !== this.generation) return this.snapshot;
      const scope = this.sessionScope!;
      const sessionGeneration = this.sessionGeneration;
      const current = () => generation === this.generation && scope === this.sessionScope && sessionGeneration === this.sessionGeneration;
      let optionalFailed = false;
      const optional = <T,>(error: unknown): T | null => {
        if (!signal.aborted && current()) optionalFailed = true;
        return optionalWebRequest<T>(error);
      };
      const include = resolveInclude(request.include);
      const metricWindow: MetricWindow = request.metricWindow ?? "5m";
      const trafficMode: TrafficCalendarMode = request.trafficMode ?? "day";
      const startedAt = this.now();
      const devicesRead = listDevices({ signal });
      // A view that names its device starts the history read alongside the
      // device list instead of waiting for it.
      const namedDeviceId = typeof request.selectedDeviceId === "string" ? request.selectedDeviceId : null;
      const earlyMetrics = namedDeviceId && include.deviceMetrics
        ? this.metricsRead(namedDeviceId, metricWindow, signal).catch((error) => optional<MetricsResponse>(error))
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
      if (!current()) return this.snapshot;
      this.durationMs = this.durationMs ? this.durationMs * 0.75 + (this.now() - startedAt) * 0.25 : this.now() - startedAt;
      this.failures = 0;
      // The fleet summary is independently useful. Do not gate its publication
      // on histories, a year-backed calendar, GitHub or IndexedDB.
      const nextSnapshot: ConsoleSnapshot = {
        generatedAt: dataTimestamp(devices, null),
        source: "live",
        cache: previous.source === "live" ? {
          ...previous.cache,
          ageSeconds: previous.cache.savedAt ? Math.max(0, Math.floor((this.now() - Date.parse(previous.cache.savedAt)) / 1000)) : null
        } : { available: false, savedAt: null, ageSeconds: null },
        session: { authenticated: true, accessKeyConfigured: true },
        localBackend: null,
        devices,
        selectedDeviceId,
        metrics: previous.source === "live" ? previous.metrics : null,
        overviewMetrics: previous.source === "live" ? previous.overviewMetrics : null,
        trafficCalendar: previous.source === "live" ? previous.trafficCalendar : null,
        update: previous.source === "live" ? previous.update : null,
        startup: { openAtLogin: false, startMinimized: false }
      };
      this.snapshot = nextSnapshot;
      this.notify();
      if (this.listeners.size) this.connectSocket();

      const apply = async <K extends "metrics" | "overviewMetrics" | "trafficCalendar" | "update">(key: K, read: Promise<ConsoleSnapshot[K]>) => {
        try {
          const value = await read;
          if (!current()) return;
          // Merge into the current snapshot, not the captured summary: another
          // optional read or a WebSocket may already have updated it.
          this.snapshot = { ...this.snapshot, [key]: value };
          if (key === "metrics") this.snapshot.generatedAt = dataTimestamp(this.snapshot.devices, this.snapshot.metrics);
          this.notify();
          this.scheduleCacheSave(scope, request, generation, sessionGeneration);
        } catch (error) {
          if (current() && (isUnauthorized(error) || (error instanceof ApiError && error.status === 403))) {
            await this.markSessionExpired();
            throw error;
          }
        }
      };
      this.scheduleCacheSave(scope, request, generation, sessionGeneration);
      // Update discovery is never on the interactive or refresh critical path.
      const required = Promise.all([
        include.deviceMetrics && selectedDeviceId
          ? apply("metrics", earlyMetrics ?? this.metricsRead(selectedDeviceId, metricWindow, signal).catch((error) => optional<MetricsResponse>(error))) : null,
        include.overviewMetrics
          ? apply("overviewMetrics", this.reads.run(`overview:${metricWindow}:${this.policy().pointBudget}`, () => getOverviewMetrics(metricWindow, { signal }, this.policy().pointBudget), signal)
            .catch((error) => optional<OverviewMetricsResponse>(error))) : null,
        include.trafficCalendar && selectedDeviceId
          ? apply("trafficCalendar", this.readTrafficCalendar(selectedDeviceId, trafficMode, request.trafficAnchor ?? new Date(this.now()).toISOString(), signal).catch((error) => optional<TrafficCalendarResponse>(error))) : null
      ]);
      void apply("update", this.readUpdateInfo()).catch(() => undefined);
      await required;
      if (current()) this.optionalFailures = optionalFailed ? Math.min(4, this.optionalFailures + 1) : 0;
      return this.snapshot;
    } catch (error) {
      if (generation !== this.generation) {
        if ((isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) && this.snapshot.source === "empty" && !this.snapshot.session.authenticated) throw error;
        return this.snapshot;
      }
      if (isUnauthorized(error) || (error instanceof ApiError && error.status === 403)) { await this.markSessionExpired(); throw error; }
      this.failures = Math.min(4, this.failures + 1);
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

  private scheduleCacheSave(scope: string, request: ConsoleSnapshotRequest, generation: number, sessionGeneration: number): void {
    if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
    const current = () => generation === this.generation && scope === this.sessionScope && sessionGeneration === this.sessionGeneration;
    this.cacheSaveTimer = setTimeout(() => {
      this.cacheSaveTimer = null;
      if (!current()) return;
      // An enriched view must replace its summary-only copy even inside the
      // normal save budget, without rewriting unchanged telemetry every poll.
      const saveKey = JSON.stringify([this.snapshot.selectedDeviceId, request.metricWindow ?? "5m", resolveInclude(request.include), request.trafficMode ?? "day", request.trafficAnchor?.slice(0, 10) ?? "", !!this.snapshot.metrics, !!this.snapshot.overviewMetrics, !!this.snapshot.trafficCalendar]);
      const lastSaved = this.cacheSavedAt.get(saveKey) ?? 0;
      if (this.now() - lastSaved < CACHE_SAVE_INTERVAL_MS && this.snapshot.cache.available) return;
      void this.cache.save(scope, this.snapshot, request, current).then((cached) => {
        if (!current()) return;
        if (cached) this.cacheSavedAt.set(saveKey, this.now());
        if (this.cacheSavedAt.size > 24) this.cacheSavedAt.delete(this.cacheSavedAt.keys().next().value!);
        this.snapshot = { ...this.snapshot, cache: { available: cached, savedAt: cached ? new Date(this.now()).toISOString() : null, ageSeconds: cached ? 0 : null } };
        this.notify();
      }).catch(() => undefined);
    }, 0);
  }

  private async markSessionExpired(broadcast = true): Promise<void> {
    this.cancelSnapshot();
    this.identityAbort.abort(new Error("session_changed"));
    this.identityAbort = new AbortController();
    const generation = ++this.generation;
    ++this.sessionGeneration;
    this.sessionInFlight = null;
    if (this.cacheSaveTimer) clearTimeout(this.cacheSaveTimer);
    this.cacheSaveTimer = null;
    this.sessionScope = null;
    this.sessionCheckedAt = 0;
    this.identityScope = null;
    this.failures = 0;
    this.optionalFailures = 0;
    this.durationMs = 0;
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
          void this.loadSnapshot({ ...this.lastRequest, selectedDeviceId: null }).catch(() => { /* The visible poller retries failed reads. */ });
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
    const wait = Math.max(0, this.lastMetricsPull + Math.max(METRICS_PUSH_MIN_INTERVAL_MS, this.policy().pushIntervalMs) - this.now());
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
    const sessionGeneration = this.sessionGeneration;
    const current = () => generation === this.generation && scope === this.sessionScope && sessionGeneration === this.sessionGeneration;
    const metricWindow: MetricWindow = this.lastRequest.metricWindow ?? "5m";
    if (!scope || this.snapshot.source !== "live" || this.snapshot.selectedDeviceId !== deviceId) return;
    this.lastMetricsPull = this.now();
    try {
      const metrics = await this.metricsRead(deviceId, metricWindow, this.snapshotAbort.signal);
      // A full read that started meanwhile owns the snapshot; so does a change
      // of device, window or session.
      if (!current() || this.snapshot.selectedDeviceId !== deviceId
        || (this.lastRequest.metricWindow ?? "5m") !== metricWindow) return;
      this.snapshot = { ...this.snapshot, metrics, generatedAt: dataTimestamp(this.snapshot.devices, metrics) };
      this.notify();
    } catch (error) {
      if (current() && (isUnauthorized(error) || (error instanceof ApiError && error.status === 403))) await this.markSessionExpired();
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
