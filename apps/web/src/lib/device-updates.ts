import type { UpdateInfo } from "@dsc/shared";

export const WEB_UPDATE_FEED = "https://raw.githubusercontent.com/IGNGserver/guanlan-monitor/updates/updates.json";
export const WEB_UPDATE_STORAGE = "guanlan-web-updates-v1";
type Channel = "stable" | "preview";
interface Release { tag_name: string; prerelease: boolean; draft: boolean; html_url: string }
interface Cache { channel?: Channel; releases?: Release[]; nextAuto?: number; nextRequest?: number; failures?: number }
interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
const MAX_BYTES = 4 * 1024 * 1024;
function defaultStore(): Store | null {
  if (typeof window !== "undefined") { try { return window.localStorage; } catch { return null; } }
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
export function compareWebVersions(left: string, right: string): number | null {
  const parse = (value: string) => {
    const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    return m && !m[4]?.split(".").some(x => /^0\d+$/.test(x)) ? m : null;
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return null;
  const numeric = (x: string, y: string) => x.length === y.length ? (x === y ? 0 : x > y ? 1 : -1) : x.length > y.length ? 1 : -1;
  for (let i = 1; i <= 3; i++) { const order = numeric(a[i], b[i]); if (order) return order; }
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : a[4] ? -1 : 1;
  const x = a[4].split("."), y = b[4].split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
    return xn && yn ? numeric(x[i], y[i]) : xn !== yn ? (xn ? -1 : 1) : x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
function validReleases(value: unknown): value is Release[] {
  return Array.isArray(value) && value.every(r => r && typeof r.tag_name === "string" && typeof r.prerelease === "boolean" && typeof r.draft === "boolean" && typeof r.html_url === "string");
}
async function readFeed(response: Response): Promise<{ releases: Release[] }> {
  if (!response.body) throw Error("empty_feed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw Error("feed_too_large"); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const feed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!feed || typeof feed !== "object") throw Error("invalid_feed");
  const body = feed as { schemaVersion?: unknown; repository?: unknown; generatedAt?: unknown; releases?: unknown };
  if (body.schemaVersion !== 1 || body.repository !== "IGNGserver/guanlan-monitor" || typeof body.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.generatedAt) || !Number.isFinite(Date.parse(body.generatedAt)) || !validReleases(body.releases)) throw Error("invalid_feed");
  return { releases: body.releases.map(r => ({ tag_name: r.tag_name, prerelease: r.prerelease, draft: r.draft, html_url: r.html_url })) };
}

/** Public release information is independent of Hub sessions and PWA activation. */
export class WebDeviceUpdates {
  private state: Cache = {};
  private pending: Promise<UpdateInfo> | null = null;
  private readonly version: string;
  private readonly now: () => number;
  private readonly store: Store | null;
  private readonly request: typeof fetch;
  constructor(version: string, now: () => number = Date.now, store: Store | null = defaultStore(), request: typeof fetch = (...args) => fetch(...args)) { this.version = version; this.now = now; this.store = store; this.request = request; this.load(); }
  private load() {
    try {
      const raw = this.store?.getItem(WEB_UPDATE_STORAGE);
      if (!raw) return;
      if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw Error("cache_too_large");
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_cache");
      this.state = value as Cache;
      if (this.state.releases !== undefined && !validReleases(this.state.releases)) { this.state.releases = undefined; this.state.nextAuto = 0; }
    } catch { this.state = {}; }
  }
  private save(settingChannel = false) {
    if (!this.store) throw Error("update_storage_unavailable");
    if (!settingChannel) {
      try { const saved: unknown = JSON.parse(this.store.getItem(WEB_UPDATE_STORAGE) ?? "{}"); const channel = (saved as Cache)?.channel; if (channel === "stable" || channel === "preview") this.state.channel = channel; } catch { /* Replace a corrupt cache after validating the new feed. */ }
    }
    this.store.setItem(WEB_UPDATE_STORAGE, JSON.stringify(this.state));
  }
  get channel(): Channel { this.load(); return this.state.channel === "stable" ? "stable" : this.state.channel === "preview" ? "preview" : process.env.NEXT_PUBLIC_DSC_RELEASE_CHANNEL === "stable" ? "stable" : "preview"; }
  setChannel(channel: Channel): UpdateInfo { this.load(); this.state.channel = channel; this.save(true); return this.cached(); }
  cached(): UpdateInfo {
    const channel = this.channel;
    const selected = (this.state.releases ?? []).filter(r => !r.draft && compareWebVersions(r.tag_name, this.version) === 1 && (channel === "preview" || (!r.prerelease && !r.tag_name.split("+")[0].includes("-"))))
      .sort((a, b) => compareWebVersions(b.tag_name, a.tag_name) ?? 0)[0];
    const releaseUrl = selected?.html_url.startsWith("https://github.com/IGNGserver/guanlan-monitor/releases/tag/") ? selected.html_url : null;
    return { currentVersion: this.version, currentChannel: channel === "stable" ? "stable" : "test", platform: "web", available: !!selected && !!releaseUrl, latestVersion: selected?.tag_name.replace(/^v/, "") ?? null, latestChannel: selected ? selected.prerelease || selected.tag_name.split("+")[0].includes("-") ? "test" : "stable" : null, releaseTag: selected?.tag_name ?? null, releaseUrl, notesUrl: releaseUrl, publishedAt: null, assetName: null, assetUrl: null, assetSize: null, sha256: null, installMode: "hub", message: "比较的是当前 Web 版本；Web/PWA 随站点部署更新，安装或切换版本由站点管理员管理。" };
  }
  check(manual = false): Promise<UpdateInfo> {
    if (this.pending) return this.pending.then(() => this.cached());
    const run = () => this.run(manual);
    const execute = typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.locks ? (async () => await navigator.locks.request("guanlan-web-update-feed", run))() : run();
    const pending = execute.finally(() => { this.pending = null; });
    this.pending = pending;
    return pending;
  }
  private async run(manual: boolean): Promise<UpdateInfo> {
    this.load();
    const now = this.now();
    if (now < (this.state.nextRequest ?? 0)) return { ...this.cached(), message: this.state.failures ? "仓库更新检查正在冷却；保留最近结果，请稍后重试。" : "已使用最近检查结果，请稍后重试。" };
    if (!manual && now < (this.state.nextAuto ?? 0)) return this.cached();
    try {
      this.state.nextRequest = now + 60_000;
      this.save();
      // Raw GitHub rejects If-None-Match CORS preflights and does not expose
      // ETag. Let the browser's HTTP cache revalidate without custom headers.
      const response = await this.request(WEB_UPDATE_FEED, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-cache", signal: AbortSignal.timeout(20_000) });
      if (response.status !== 304 && !response.ok) {
        const retry = response.headers.get("Retry-After");
        const retryAt = retry ? (/^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)) : 0;
        this.state.nextRequest = Math.max(this.state.nextRequest, retryAt || 0, Number(response.headers.get("X-RateLimit-Reset") ?? 0) * 1000);
        throw Error(`update_http_${response.status}`);
      }
      if (response.status === 304) { if (!this.state.releases) throw Error("cache_missing"); }
      else this.state.releases = (await readFeed(response)).releases;
      this.state.failures = 0;
      this.state.nextAuto = now + 6 * 3600_000 + Math.random() * 30 * 60_000;
      this.save();
      return this.cached();
    } catch {
      this.state.failures = Math.min(10, (this.state.failures ?? 0) + 1);
      this.state.nextRequest = Math.max(this.state.nextRequest ?? 0, now + Math.min(6 * 3600_000, 60_000 * 2 ** this.state.failures));
      try { this.save(); } catch { return { ...this.cached(), message: "浏览器无法保存更新缓存，已暂停后续检查；请检查本地存储权限。" }; }
      return { ...this.cached(), message: "仓库更新信息暂不可用，已保留最近结果并稍后重试；Web/PWA 仍随站点部署更新。" };
    }
  }
}
