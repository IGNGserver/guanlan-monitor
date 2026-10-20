import { safeStorage } from "electron";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { desktopUpdatePlatform } from "./platform.js";
import type {
  AuthLoginResponse,
  DeviceSummary,
  LiveConnection,
  LiveSnapshot,
  LiveTopic,
  MetricsResponse,
  MetricWindow,
  OverviewMetricsResponse,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  UpdateInfo
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

export class HubClient {
  onSessionDenied?: () => void;
  private accessKey: string | null = null;
  private sessionCookie: string | null = null;
  private serverUrl = "";
  private updateCache: { key: string; expiresAt: number; value: UpdateInfo } | null = null;
  private overviewCache: { key: string; expiresAt: number; value: OverviewMetricsResponse } | null = null;
  private sessionInFlight: Promise<void> | null = null;
  private connectionEpoch = 0;
  private identity: string = randomUUID();
  private identityAbort = new AbortController();
  private credentialWrites: Promise<void> = Promise.resolve();

  constructor(private readonly credentialPath: string) {}

  async initialize(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredAccessKey;
      if (![1, 2].includes(stored.version) || !stored.value) return;
      if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
        const decoded = safeStorage.decryptString(Buffer.from(stored.value, "base64"));
        if (stored.version === 1) this.accessKey = decoded;
        else {
          const payload = JSON.parse(decoded) as { accessKey: string; identity: string };
          if (typeof payload.accessKey !== "string" || !payload.accessKey || typeof payload.identity !== "string" || !/^[a-f0-9-]{36}$/.test(payload.identity)) return;
          this.accessKey = payload.accessKey; this.identity = payload.identity;
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
        this.overviewCache = null;
        this.updateCache = null;
      }
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.accessKey);
  }

  get cacheScope(): string | null { return this.accessKey && this.serverUrl ? `${this.serverUrl}\u001f${this.identity}` : null; }
  get configuredUrl(): string { return this.serverUrl; }

  invalidateSession(): void {
    this.identityAbort.abort(new Error("hub_session_changed"));
    this.identityAbort = new AbortController();
    ++this.connectionEpoch;
    this.sessionCookie = null; this.sessionInFlight = null;
    this.overviewCache = null; this.updateCache = null;
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
      this.overviewCache = null;
      this.updateCache = null;
      if (this.accessKey !== value) this.identity = randomUUID();
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
    this.overviewCache = null;
    this.updateCache = null;
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
    return this.authorized<DeviceSummary[]>("/api/instances", { signal });
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
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    await this.authorized<{ ok: boolean }>("/api/devices/reorder", {
      method: "PUT",
      body: JSON.stringify({ deviceIds })
    });
  }

  async getMetrics(deviceId: string, metricWindow: MetricWindow, signal?: AbortSignal, pointBudget?: number): Promise<MetricsResponse> {
    return this.authorized<MetricsResponse>(`/api/devices/${encodeURIComponent(deviceId)}/metrics?window=${encodeURIComponent(metricWindow)}${pointBudget ? `&pointBudget=${pointBudget}` : ""}`, { signal });
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
  }

  async getUpdateInfo(currentVersion: string, signal?: AbortSignal): Promise<UpdateInfo> {
    const key = `${this.serverUrl}|${currentVersion}`;
    const epoch = this.connectionEpoch;
    if (this.updateCache?.key === key && Date.now() < this.updateCache.expiresAt) return this.updateCache.value;
    const platform = desktopUpdatePlatform();
    const params = new URLSearchParams({
      platform,
      currentVersion,
      currentChannel: "test"
    });
    const value = await this.request<UpdateInfo>(`/api/updates?${params.toString()}`, { includeSession: false, signal });
    if (epoch === this.connectionEpoch && !signal?.aborted) this.updateCache = { key, expiresAt: Date.now() + 15 * 60_000, value };
    return value;
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

  private async persistAccessKey(value: string, epoch: number): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(JSON.stringify({ accessKey: value, identity: this.identity })).toString("base64");
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
    return payload as T;
  }

  private captureSessionCookie(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    const session = values.map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("dsc_session="));
    if (session) this.sessionCookie = session;
  }
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
