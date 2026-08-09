import { safeStorage } from "electron";
import { isIP } from "node:net";
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
      if (parsed.username || parsed.password) {
        this.serverUrl = "";
        return false;
      }
      const localHost = isPrivateNetworkHost(parsed.hostname);
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

  async deleteDevice(deviceId: string): Promise<void> {
    await this.ensureSession();
    await this.request<{ ok: boolean }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE"
    });
  }

  async reorderDevices(deviceIds: string[]): Promise<void> {
    await this.ensureSession();
    await this.request<{ ok: boolean }>("/api/devices/reorder", {
      method: "PUT",
      body: JSON.stringify({ deviceIds })
    });
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
 