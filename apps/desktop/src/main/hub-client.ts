import { safeStorage } from "electron";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  AuthLoginResponse,
  DeviceSummary,
  MetricsResponse,
  MetricWindow,
  TrafficCalendarMode,
  TrafficCalendarResponse,
  UpdateInfo
} from "@dsc/shared";
import { writeJsonAtomically } from "./atomic-json.js";

interface StoredAccessKey {
  version: 1;
  encrypted: boolean;
  value: string;
}

export class HubClient {
  private accessKey: string | null = null;
  private sessionCookie: string | null = null;
  private serverUrl = "";

  constructor(private readonly credentialPath: string) {}

  async initialize(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.credentialPath, "utf8")) as StoredAccessKey;
      if (stored.version !== 1 || !stored.value) return;
      if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
        this.accessKey = safeStorage.decryptString(Buffer.from(stored.value, "base64"));
      }
    } catch {
      // A missing or unreadable credential is the normal signed-out state.
    }
  }

  setServerUrl(value: string): boolean {
    const normalized = value.trim().replace(/\/$/, "");
    try {
      const parsed = new URL(normalized);
      const localHost = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
        this.serverUrl = "";
        return false;
      }
      this.serverUrl = normalized;
      return true;
    } catch {
      this.serverUrl = "";
      return false;
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.accessKey);
  }

  /** The unified Hub credential is also the Agent upload credential. */
  get credentialForAgent(): string | null {
    return this.accessKey;
  }

  async login(accessKey: string): Promise<void> {
    const value = accessKey.trim();
    if (!value) throw new Error("access_key_required");
    const payload = await this.request<AuthLoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ accessKey: value }),
      includeSession: false
    }, value);
    if (!payload.ok) throw new Error("login_failed");
    this.accessKey = value;
    await this.persistAccessKey(value);
  }

  async logout(): Promise<void> {
    if (this.sessionCookie && this.serverUrl) {
      try {
        await this.request("/api/auth/logout", { method: "POST" });
      } catch {
        // Local sign-out still succeeds when the Hub is offline.
      }
    }
    this.accessKey = null;
    this.sessionCookie = null;
    try {
      await unlink(this.credentialPath);
    } catch {
      // The credential file may not exist.
    }
  }

  async listDevices(): Promise<DeviceSummary[]> {
    await this.ensureSession();
    return this.request<DeviceSummary[]>("/api/devices");
  }

  async getMetrics(deviceId: string, metricWindow: MetricWindow): Promise<MetricsResponse> {
    await this.ensureSession();
    return this.request<MetricsResponse>(`/api/devices/${encodeURIComponent(deviceId)}/metrics?window=${encodeURIComponent(metricWindow)}`);
  }

  async getTrafficCalendar(
    deviceId: string,
    mode: TrafficCalendarMode,
    anchor: string
  ): Promise<TrafficCalendarResponse> {
    await this.ensureSession();
    const params = new URLSearchParams({ mode, anchor });
    return this.request<TrafficCalendarResponse>(
      `/api/devices/${encodeURIComponent(deviceId)}/traffic-calendar?${params.toString()}`
    );
  }

  async saveFanNote(deviceId: string, fanId: string, note: string): Promise<void> {
    await this.ensureSession();
    await this.request(`/api/devices/${encodeURIComponent(deviceId)}/fans/${encodeURIComponent(fanId)}/note`, {
      method: "PUT",
      body: JSON.stringify({ note: note.slice(0, 100) })
    });
  }

  async getUpdateInfo(currentVersion: string): Promise<UpdateInfo> {
    const platform = process.platform === "win32" ? "windows-gui" : "linux-gui";
    const params = new URLSearchParams({
      platform,
      currentVersion,
      currentChannel: "test"
    });
    return this.request<UpdateInfo>(`/api/updates?${params.toString()}`, { includeSession: false });
  }

  private async ensureSession(): Promise<void> {
    if (!this.serverUrl) throw new Error("hub_server_url_missing");
    if (this.sessionCookie) return;
    if (!this.accessKey) throw new Error("hub_login_required");
    await this.login(this.accessKey);
  }

  private async persistAccessKey(value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(value).toString("base64");
    await writeJsonAtomically(this.credentialPath, {
      version: 1,
      encrypted: true,
      value: encrypted
    } satisfies StoredAccessKey);
  }

  private async request<T = unknown>(
    endpoint: string,
    init: RequestInit & { includeSession?: boolean } = {},
    loginKey?: string
  ): Promise<T> {
    if (!this.serverUrl) throw new Error("hub_server_url_missing");
    const { includeSession = true, ...requestInit } = init;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(requestInit.headers ? Object.fromEntries(new Headers(requestInit.headers).entries()) : {})
    };
    if (includeSession && this.sessionCookie) headers.Cookie = this.sessionCookie;
    const response = await fetch(`${this.serverUrl}${endpoint}`, {
      ...requestInit,
      headers,
      signal: requestInit.signal ?? AbortSignal.timeout(12_000)
    });
    this.captureSessionCookie(response);
    const text = await response.text();
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
      throw new Error(`hub_${response.status}:${detail}`);
    }
    if (loginKey && response.status === 200) this.accessKey = loginKey;
    return payload as T;
  }

  private captureSessionCookie(response: Response): void {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
    const session = values.map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("dsc_session="));
    if (session) this.sessionCookie = session;
  }
}

export function credentialFilePath(userDataPath: string): string {
  return path.join(userDataPath, "hub-credential.json");
}
