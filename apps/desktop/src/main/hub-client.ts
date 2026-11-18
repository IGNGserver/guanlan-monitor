import { safeStorage } from "electron";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  AuthLoginResponse,
  DeviceSummary,
  LiveConnection,
  LiveSnapshot,
  LiveTopic,
  MetricsResponse,
  MetricSeries,
  MetricWindow,
  OverviewMetricsResponse,
  SamplePoint,
  TrafficCalendarMode,
  TrafficCalendarResponse
} from "@dsc/shared";
import { writeJsonAtomically } from "./atomic-json.js";
import { withReadDeadline } from "./read-deadline.js";

interface StoredAccessKey {
  version: 1 | 2;
  encrypted: boolean;
  value: string;
}

/** The fleet overview is cached briefly; see `getOverviewMetrics`. */
const OVERVIEW_CACHE_TTL_MS = 30_000;
const MAX_METRICS_CACHE_ENTRIES = 12;
const INCREMENTAL_METRIC_WINDOWS: Partial<Record<MetricWindow, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000
};

export class HubClient {
  onSessionDenied?: () => void;
  private accessKey: string | null = null;
  private sessionCookie: string | null = null;
  private serverUrl = "";
  private overviewCache: { key: string; expiresAt: number; value: OverviewMetricsResponse } | null = null;
  private devicesCache: { scope: string; etag: string; value: DeviceSummary[] } | null = null;
  private readonly metricsCache = new Map<string, { since: string; response: MetricsResponse }>();
  private sessionInFlight: Promise<void> | null = null;
  private connectionEpoch = 0;
  private identity: string = randomUUID();
  private identityAbort = new AbortController();
  private credentialWrites: Promise<void> = Promise.resolve();

  constructor(private readonly credentialPath: string) {}

  private clearResponseCaches(): void {
    this.overviewCache = null;
    this.devicesCache = null;
    this.metricsCache.clear();
  }

  async initialize(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredAccessKey;
      if (![1, 2].includes(stored.version) || !stored.value) return;
      if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
        const decoded = safeStorage.decryptString(Buffer.from(stored.value, "base64"));
        if (stored.version === 1) this.accessKey = decoded;
        else {
          const payload = JSON.parse(decoded) as { accessKey: string; identity: string; serverUrl?: string };
          if (typeof payload.accessKey !== "string" || !payload.accessKey || typeof payload.identity !== "string" || !/^[a-f0-9-]{36}$/.test(payload.identity)) return;
          this.accessKey = payload.accessKey; this.identity = payload.identity;
          if (typeof payload.serverUrl === "string") this.setServerUrl(payload.serverUrl);
        }
      }
    } catch {
      // A missing or unreadable credential is the normal signed-out state.
    }
  }

  setServerUrl(value: string): boolean {
    const normalized = value.trim().replace(/\/$/, "");
    const previous = this.serverUrl;
    try {
      const parsed = new URL(normalized);
      if (parsed.username || parsed.password) {
        this.serverUrl = "";
        return false;
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        this.serverUrl = "";
        return false;
      }
      const localHost = isPrivateNetworkHost(parsed.hostname);
      if (parsed.protocol === "http:" && !localHost) {
        console.warn(`[HubClient] Connecting to remote Hub over unencrypted HTTP: ${normalized}`);
      }
      this.serverUrl = normalized;
      return true;
    } catch {
      this.serverUrl = "";
      return false;
    } finally {
      if (previous !== this.serverUrl) {
        this.identityAbort.abort(new Error("hub_session_changed"));
        this.identityAbort = new AbortController();
        this.connectionEpoch++;
        this.sessionCookie = null;
        this.sessionInFlight = null;
        this.clearResponseCaches();
      }
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.accessKey);
  }

  get cacheScope(): string | null { return this.accessKey && this.serverUrl ? `${this.serverUrl}\u001f${this.identity}` : null; }
  get configuredUrl(): string { return this.serverUrl; }

  invalidateSession(preserveLogoutCookie = false): void {
    this.identityAbort.abort(new Error("hub_session_changed"));
    this.identityAbort = new AbortController();
    ++this.connectionEpoch;
    if (!preserveLogoutCookie) this.sessionCookie = null;
    this.sessionInFlight = null;
    this.clearResponseCaches();
  }

  /** The unified Hub credential is also the Agent upload credential. */
  get credentialForAgent(): string | null {
    return this.accessKey;
  }

  async login(accessKey: string): Promise<void> {
    return this.authenticate(accessKey, true);
  }

  private async authenticate(accessKey: string, replaceSession: boolean): Promise<void> {
    const value = accessKey.trim();
    if (!value) throw new Error("access_key_required");
    if (replaceSession) {
      this.identityAbort.abort(new Error("hub_session_changed"));
      this.identityAbort = new AbortController();
      this.connectionEpoch++;
      this.sessionCookie = null;
      this.sessionInFlight = null;
      this.clearResponseCaches();
      if (this.accessKey !== value) this.identity = randomUUID();
      // An explicit rejected replacement must not silently log back in with
      // the previous account on the next timer tick.
      this.accessKey = null;
    }
    const epoch = this.connectionEpoch;
    const payload = await this.request<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ accessKey: value }),
      includeSession: false
    });
    if (epoch !== this.connectionEpoch) throw new Error("hub_session_changed");
    if (!payload.ok) throw new Error("login_failed");
    this.accessKey = value;
    await this.persistAccessKey(value, epoch);
  }

  async logout(): Promise<void> {
    this.identityAbort.abort(new Error("hub_session_changed"));
    this.identityAbort = new AbortController();
    const epoch = ++this.connectionEpoch;
    this.accessKey = null;
    this.identity = randomUUID();
    this.clearResponseCaches();
    this.sessionInFlight = null;
    if (this.sessionCookie && this.serverUrl) {
      try {
        await this.request("/api/auth/logout", { method: "POST" });
      } catch {
        // Local sign-out still succeeds when the Hub is offline.
      }
    }
    if (epoch !== this.connectionEpoch) return;
    this.sessionCookie = null;
    const remove = this.credentialWrites.catch(() => {}).then(async () => {
      if (epoch !== this.connectionEpoch) return;
      await unlink(this.credentialPath).catch(() => {});
    });
    this.credentialWrites = remove;
    await remove;
  }

  async listDevices(signal?: AbortSignal): Promise<DeviceSummary[]> {
    const scope = this.cacheScope;
    const epoch = this.connectionEpoch;
    const cached = scope && this.devicesCache?.scope === scope ? this.devicesCache : null;
    const result = await this.authorizedConditional<DeviceSummary[]>(
      "/api/instances",
      { signal },
      cached?.etag
    );
    if (result.notModified && cached) {
      return cached.value;
    }
    const devices = result.payload;
    if (epoch === this.connectionEpoch && !signal?.aborted && scope && result.etag) {
      this.devicesCache = { scope, etag: result.etag, value: devices };
    }
    return devices;
  }

  async getLiveConnection(deviceId: string): Promise<LiveConnection> {
    return this.liveRequest<LiveConnection>(`/api/devices/${encodeURIComponent(deviceId)}/live`);
  }

  async readLive<T extends LiveTopic>(deviceId: string, topic: T): Promise<LiveSnapshot<T>> {
    return this.liveRequest<LiveSnapshot<T>>(`/api/devices/${encodeURIComponent(deviceId)}/live/${topic}`);
  }

  async resetLiveCredentials(deviceId: string): Promise<void> {
    await this.liveRequest<{ ok: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}/live/reset`, { method: "POST", body: "{}" });
  }

  private async liveRequest<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    if (!this.accessKey) throw new Error("hub_login_required");
    const epoch = this.connectionEpoch;
    await this.ensureSession();
    if (epoch !== this.connectionEpoch || !this.accessKey) throw new Error("hub_session_changed");
    return this.request<T>(endpoint, init);
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.authorized<{ ok: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE"
    });
    this.devicesCache = null;
    this.metricsCache.clear();
  }

  async renameDevice(deviceId: string, nextDeviceId: string): Promise<void> {
    await this.authorized<{ ok: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}/id`, {
      method: "PUT",
      body: JSON.stringify({ deviceId: nextDeviceId })
    });
    this.devicesCache = null;
    this.metricsCache.clear();
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    await this.authorized<{ ok: boolean }>("/api/devices/reorder", {
      method: "PUT",
      body: JSON.stringify({ deviceIds })
    });
    this.devicesCache = null;
  }

  async updateDeviceGroup(deviceIds: string[], group: string | null): Promise<void> {
    await this.authorized<{ ok: boolean }>("/api/devices/group", {
      method: "PUT",
      body: JSON.stringify({ deviceIds, group })
    });
    this.devicesCache = null;
  }

  async getMetrics(deviceId: string, metricWindow: MetricWindow, signal?: AbortSignal, pointBudget?: number): Promise<MetricsResponse> {
    const scope = this.cacheScope;
    const epoch = this.connectionEpoch;
    const incrementalWindowMs = !pointBudget ? INCREMENTAL_METRIC_WINDOWS[metricWindow] : undefined;
    const cacheKey = scope && incrementalWindowMs ? `${scope}\u001f${deviceId}\u001f${metricWindow}` : null;
    const cached = cacheKey ? this.metricsCache.get(cacheKey) : undefined;

    const params = new URLSearchParams({ window: metricWindow });
    if (pointBudget) params.set("pointBudget", String(pointBudget));
    if (cached) params.set("since", cached.since);

    const response = await this.authorized<MetricsResponse>(
      `/api/devices/${encodeURIComponent(deviceId)}/metrics?${params.toString()}`,
      { signal }
    );

    if (!cacheKey || !incrementalWindowMs) {
      return response;
    }

    const merged = cached && response.incremental
      ? mergeIncrementalMetricsResponse(cached.response, response, incrementalWindowMs)
      : response;

    if (epoch === this.connectionEpoch && !signal?.aborted) {
      const latestTimestamp = newestSeriesTimestamp(merged.series);
      if (latestTimestamp) {
        this.metricsCache.delete(cacheKey);
        this.metricsCache.set(cacheKey, { since: latestTimestamp, response: merged });
        while (this.metricsCache.size > MAX_METRICS_CACHE_ENTRIES) {
          const oldestKey = this.metricsCache.keys().next().value;
          if (!oldestKey) break;
          this.metricsCache.delete(oldestKey);
        }
      }
    }
    return merged;
  }

  async getOverviewMetrics(metricWindow: MetricWindow, signal?: AbortSignal, pointBudget?: number): Promise<OverviewMetricsResponse> {
    // The fleet-wide overview moves on the order of minutes, but the device page
    // polls it every refresh. A short cache keyed on window and hub removes the
    // redundant request without hiding a real change for long.
    const key = `${this.cacheScope}|${metricWindow}|${pointBudget}`;
    const epoch = this.connectionEpoch;
    if (this.overviewCache?.key === key && Date.now() < this.overviewCache.expiresAt) return this.overviewCache.value;
    const value = await this.authorized<OverviewMetricsResponse>(`/api/overview/metrics?window=${encodeURIComponent(metricWindow)}${pointBudget ? `&pointBudget=${pointBudget}` : ""}`, { signal });
    if (epoch === this.connectionEpoch && !signal?.aborted) this.overviewCache = { key, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS, value };
    return value;
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchor: string,
    signal?: AbortSignal
  ): Promise<TrafficCalendarResponse> {
    const params = new URLSearchParams({ mode, anchor });
    return this.authorized<TrafficCalendarResponse>(
      `/api/devices/${encodeURIComponent(deviceId)}/traffic-calendar?${params.toString()}`, { signal }
    );
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<void> {
    await this.authorized(`/api/devices/${encodeURIComponent(deviceId)}/fans/${encodeURIComponent(fanId)}/note`, {
      method: "PUT",
      body: JSON.stringify({ note: note.slice(0, 100) })
    });
    this.metricsCache.clear();
  }


  private async ensureSession(): Promise<void> {
    if (!this.serverUrl) throw new Error("hub_server_url_missing");
    if (this.sessionCookie) return;
    if (!this.accessKey) throw new Error("hub_login_required");
    this.sessionInFlight ??= this.authenticate(this.accessKey, false);
    const pending = this.sessionInFlight;
    try {
      await pending;
    } finally {
      if (this.sessionInFlight === pending) this.sessionInFlight = null;
    }
  }

  private async authorized<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const epoch = this.connectionEpoch;
    if (init.signal?.aborted) throw new Error("hub_request_cancelled");
    await withReadDeadline(() => this.ensureSession(), [init.signal, this.identityAbort.signal]);
    if (epoch !== this.connectionEpoch || init.signal?.aborted) throw new Error("hub_session_changed");
    return this.request<T>(endpoint, init);
  }

  private async authorizedConditional<T>(
    endpoint: string,
    init: RequestInit = {},
    etag?: string
  ): Promise<{ notModified: boolean; etag: string | null; payload: T }> {
    const epoch = this.connectionEpoch;
    if (init.signal?.aborted) throw new Error("hub_request_cancelled");
    await withReadDeadline(() => this.ensureSession(), [init.signal, this.identityAbort.signal]);
    if (epoch !== this.connectionEpoch || init.signal?.aborted) throw new Error("hub_session_changed");
    const headers: Record<string, string> = {};
    if (etag) headers["If-None-Match"] = etag;
    return this.requestConditional<T>(endpoint, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...headers }
    }, Boolean(etag));
  }

  private async persistAccessKey(value: string, epoch: number): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(JSON.stringify({ accessKey: value, identity: this.identity, serverUrl: this.serverUrl })).toString("base64");
    const operation = this.credentialWrites.catch(() => {}).then(async () => {
      if (epoch !== this.connectionEpoch) return;
      await writeJsonAtomically(this.credentialPath, { version: 2, encrypted: true, value: encrypted } satisfies StoredAccessKey);
    });
    this.credentialWrites = operation;
    await operation;
  }

  private async request<T = unknown>(
    endpoint: string,
    init: RequestInit & { includeSession?: boolean } = {}
  ): Promise<T> {
    const result = await this.requestConditional<T>(endpoint, init, false);
    return result.payload;
  }

  private async requestConditional<T = unknown>(
    endpoint: string,
    init: RequestInit & { includeSession?: boolean } = {},
    allowNotModified = false
  ): Promise<{ notModified: boolean; etag: string | null; payload: T }> {
    if (!this.serverUrl) throw new Error("hub_server_url_missing");
    const serverUrl = this.serverUrl;
    const epoch = this.connectionEpoch;
    const assertCurrent = () => { if (epoch !== this.connectionEpoch || init.signal?.aborted) throw new Error("hub_session_changed"); };
    const { includeSession = true, ...requestInit } = init;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    if (requestInit.headers) {
      if (typeof requestInit.headers === "object" && !(requestInit.headers instanceof Headers)) {
        Object.assign(headers, requestInit.headers);
      }
    }
    if (includeSession && this.sessionCookie) {
      headers["Cookie"] = this.sessionCookie;
    }
    const send = () => withReadDeadline(async (signal) => {
      const response = await fetch(`${serverUrl}${endpoint}`, { ...requestInit, headers, signal });
      if (allowNotModified && response.status === 304) {
        return { response, text: "" };
      }
      const text = await response.text();
      return { response, text };
    }, [requestInit.signal, this.identityAbort.signal]);
    let { response, text } = await send();
    assertCurrent();
    this.captureSessionCookie(response);

    // Only idempotent GETs may reauthenticate and retry. Never replay a write.
    if (response.status === 401 && includeSession && this.accessKey && (requestInit.method ?? "GET") === "GET") {
      if (this.sessionCookie === headers.Cookie) this.sessionCookie = null;
      try {
        await withReadDeadline(() => this.ensureSession(), [requestInit.signal, this.identityAbort.signal]);
        assertCurrent();
        if (this.sessionCookie) {
          headers["Cookie"] = this.sessionCookie;
        }
        ({ response, text } = await send());
        assertCurrent();
        this.captureSessionCookie(response);
      } catch {
        assertCurrent();
        // If re-login fails, fall through to normal error handling
      }
    }

    assertCurrent();
    const responseEtag = typeof response.headers?.get === "function" ? response.headers.get("etag") : null;
    if (allowNotModified && response.status === 304) {
      return { notModified: true, etag: responseEtag, payload: null as T };
    }
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      const detail = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
      if (includeSession && (response.status === 401 || response.status === 403)) this.onSessionDenied?.();
      throw new Error(`hub_${response.status}:${detail}`);
    }
    return { notModified: false, etag: responseEtag, payload: payload as T };
  }

  private captureSessionCookie(response: Response): void {
    const headers = response.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
    if (!headers || typeof headers.get !== "function") return;
    const values = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    const session = values.map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("dsc_session="));
    if (session) this.sessionCookie = session;
  }
}

const SCALAR_SERIES_KEYS = [
  "cpuUsagePercent",
  "cpuFrequencyMHz",
  "cpuTemperatureC",
  "gpuUsagePercent",
  "gpuEncodePercent",
  "gpuDecodePercent",
  "gpuFrequencyMHz",
  "gpuMemoryUsagePercent",
  "gpuMemoryUsedBytes",
  "gpuTemperatureC",
  "memoryUsagePercent",
  "swapUsagePercent",
  "memoryUsedBytes",
  "swapUsedBytes",
  "memoryAvailableBytes",
  "memoryCachedBytes",
  "memoryCommittedBytes",
  "memoryCommitLimitBytes",
  "systemProcessCount",
  "systemThreadCount",
  "systemHandleCount",
  "diskUsagePercent",
  "diskUsedBytes",
  "diskReadBytesPerSec",
  "diskWriteBytesPerSec",
  "networkRxBytesPerSec",
  "networkTxBytesPerSec",
  "trafficRxBytes",
  "trafficTxBytes"
] as const;

function mergeSamplePoints(previous: SamplePoint[] | undefined, incoming: SamplePoint[] | undefined, cutoffMs: number): SamplePoint[] {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (!prev.length && !next.length) return [];
  const merged = new Map<string, SamplePoint>();
  for (const point of prev) {
    const ts = Date.parse(point.timestamp);
    if (Number.isFinite(ts) && ts >= cutoffMs) {
      merged.set(point.timestamp, point);
    }
  }
  for (const point of next) {
    const ts = Date.parse(point.timestamp);
    if (Number.isFinite(ts) && ts >= cutoffMs) {
      merged.set(point.timestamp, point);
    }
  }
  return [...merged.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function mergeIncrementalMetricsResponse(previous: MetricsResponse, delta: MetricsResponse, windowMs: number): MetricsResponse {
  const parsedStart = Date.parse(delta.rangeStart);
  const cutoffMs = Number.isFinite(parsedStart) ? parsedStart : Date.now() - windowMs;
  const prevSeries = previous.series;
  const nextSeries = delta.series;

  const mergedSeries = { ...nextSeries } as MetricSeries;
  for (const key of SCALAR_SERIES_KEYS) {
    mergedSeries[key] = mergeSamplePoints(prevSeries?.[key], nextSeries?.[key], cutoffMs);
  }

  const prevCpus = new Map((prevSeries?.cpus ?? []).map((item) => [item.id, item]));
  mergedSeries.cpus = (nextSeries?.cpus ?? []).map((cpu) => {
    const prev = prevCpus.get(cpu.id);
    return {
      ...cpu,
      usagePercent: mergeSamplePoints(prev?.usagePercent, cpu.usagePercent, cutoffMs),
      frequencyMHz: mergeSamplePoints(prev?.frequencyMHz, cpu.frequencyMHz, cutoffMs),
      temperatureC: mergeSamplePoints(prev?.temperatureC, cpu.temperatureC, cutoffMs)
    };
  });

  const prevDisks = new Map((prevSeries?.disks ?? []).map((item) => [item.id, item]));
  mergedSeries.disks = (nextSeries?.disks ?? []).map((disk) => {
    const prev = prevDisks.get(disk.id);
    return {
      ...disk,
      totalBytes: mergeSamplePoints(prev?.totalBytes, disk.totalBytes, cutoffMs),
      usagePercent: mergeSamplePoints(prev?.usagePercent, disk.usagePercent, cutoffMs),
      activePercent: mergeSamplePoints(prev?.activePercent, disk.activePercent, cutoffMs),
      usedBytes: mergeSamplePoints(prev?.usedBytes, disk.usedBytes, cutoffMs),
      readBytesPerSec: mergeSamplePoints(prev?.readBytesPerSec, disk.readBytesPerSec, cutoffMs),
      writeBytesPerSec: mergeSamplePoints(prev?.writeBytesPerSec, disk.writeBytesPerSec, cutoffMs),
      temperatureC: mergeSamplePoints(prev?.temperatureC, disk.temperatureC, cutoffMs)
    };
  });

  const prevPools = new Map((prevSeries?.storagePools ?? []).map((item) => [item.id, item]));
  mergedSeries.storagePools = (nextSeries?.storagePools ?? []).map((pool) => {
    const prev = prevPools.get(pool.id);
    return {
      ...pool,
      totalBytes: mergeSamplePoints(prev?.totalBytes, pool.totalBytes, cutoffMs),
      usedBytes: mergeSamplePoints(prev?.usedBytes, pool.usedBytes, cutoffMs),
      availableBytes: mergeSamplePoints(prev?.availableBytes, pool.availableBytes, cutoffMs),
      usagePercent: mergeSamplePoints(prev?.usagePercent, pool.usagePercent, cutoffMs)
    };
  });

  const prevNetworks = new Map((prevSeries?.networks ?? []).map((item) => [item.id, item]));
  mergedSeries.networks = (nextSeries?.networks ?? []).map((network) => {
    const prev = prevNetworks.get(network.id);
    return {
      ...network,
      rxBytesPerSec: mergeSamplePoints(prev?.rxBytesPerSec, network.rxBytesPerSec, cutoffMs),
      txBytesPerSec: mergeSamplePoints(prev?.txBytesPerSec, network.txBytesPerSec, cutoffMs),
      trafficRxBytes: mergeSamplePoints(prev?.trafficRxBytes, network.trafficRxBytes, cutoffMs),
      trafficTxBytes: mergeSamplePoints(prev?.trafficTxBytes, network.trafficTxBytes, cutoffMs)
    };
  });

  const prevGpus = new Map((prevSeries?.gpus ?? []).map((item) => [item.id, item]));
  mergedSeries.gpus = (nextSeries?.gpus ?? []).map((gpu) => {
    const prev = prevGpus.get(gpu.id);
    return {
      ...gpu,
      usagePercent: mergeSamplePoints(prev?.usagePercent, gpu.usagePercent, cutoffMs),
      encodePercent: mergeSamplePoints(prev?.encodePercent, gpu.encodePercent, cutoffMs),
      decodePercent: mergeSamplePoints(prev?.decodePercent, gpu.decodePercent, cutoffMs),
      frequencyMHz: mergeSamplePoints(prev?.frequencyMHz, gpu.frequencyMHz, cutoffMs),
      memoryUsagePercent: mergeSamplePoints(prev?.memoryUsagePercent, gpu.memoryUsagePercent, cutoffMs),
      memoryUsedBytes: mergeSamplePoints(prev?.memoryUsedBytes, gpu.memoryUsedBytes, cutoffMs),
      temperatureC: mergeSamplePoints(prev?.temperatureC, gpu.temperatureC, cutoffMs)
    };
  });

  const prevTemps = new Map((prevSeries?.temperatureSensors ?? []).map((item) => [item.id, item]));
  mergedSeries.temperatureSensors = (nextSeries?.temperatureSensors ?? []).map((sensor) => {
    const prev = prevTemps.get(sensor.id);
    return {
      ...sensor,
      currentC: mergeSamplePoints(prev?.currentC, sensor.currentC, cutoffMs)
    };
  });

  const prevFans = new Map((prevSeries?.fans ?? []).map((item) => [item.id, item]));
  mergedSeries.fans = (nextSeries?.fans ?? []).map((fan) => {
    const prev = prevFans.get(fan.id);
    return {
      ...fan,
      rpm: mergeSamplePoints(prev?.rpm, fan.rpm, cutoffMs)
    };
  });

  const { incremental: _incremental, ...rest } = delta;
  return {
    ...rest,
    series: mergedSeries
  };
}

function newestSeriesTimestamp(series: MetricSeries | undefined): string | null {
  if (!series || typeof series !== "object") return null;
  let maxMs = -Infinity;
  let newest: string | null = null;
  const inspect = (points: SamplePoint[] | undefined) => {
    if (!Array.isArray(points) || !points.length) return;
    const tail = points[points.length - 1];
    const ts = Date.parse(tail.timestamp);
    if (Number.isFinite(ts) && ts > maxMs) {
      maxMs = ts;
      newest = tail.timestamp;
    }
  };
  for (const key of SCALAR_SERIES_KEYS) {
    inspect(series[key]);
  }
  for (const cpu of series.cpus ?? []) {
    inspect(cpu.usagePercent);
    inspect(cpu.frequencyMHz);
    inspect(cpu.temperatureC);
  }
  for (const disk of series.disks ?? []) {
    inspect(disk.usagePercent);
    inspect(disk.readBytesPerSec);
    inspect(disk.writeBytesPerSec);
  }
  for (const net of series.networks ?? []) {
    inspect(net.rxBytesPerSec);
    inspect(net.txBytesPerSec);
  }
  for (const gpu of series.gpus ?? []) {
    inspect(gpu.usagePercent);
    inspect(gpu.memoryUsagePercent);
  }
  for (const sensor of series.temperatureSensors ?? []) {
    inspect(sensor.currentC);
  }
  for (const fan of series.fans ?? []) {
    inspect(fan.rpm);
  }
  return newest;
}

function isPrivateNetworkHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const family = isIP(host);
  if (family === 4) {
    const octets = host.split(".").map(Number);
    const [first, second] = octets;
    return first === 127
      || first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254);
  }
  if (family === 6) return host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
  return false;
}

export function credentialFilePath(userDataPath: string): string {
  return path.join(userDataPath, "hub-credential.json");
}
