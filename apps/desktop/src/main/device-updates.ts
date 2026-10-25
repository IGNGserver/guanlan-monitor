import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { UpdateInfo, UpdatePlatform } from "@dsc/shared";

export type UpdateChannel = "stable" | "preview";
export const UPDATE_FEED = "https://raw.githubusercontent.com/IGNGserver/guanlan-monitor/updates/updates.json";
export interface ReleaseAsset { name: string; browser_download_url: string; size: number; digest?: string; state?: string }
export interface FeedRelease { tag_name: string; prerelease: boolean; draft: boolean; html_url: string; published_at?: string; assets: ReleaseAsset[] }
interface State { etag?: string; releases?: FeedRelease[]; nextAutoAt?: number; nextRequestAt?: number; failures?: number; channel?: UpdateChannel }
const MAX_FEED_BYTES = 4 * 1024 * 1024;
function validReleases(value: unknown): value is FeedRelease[] {
  return Array.isArray(value) && value.every(r => r && typeof r === "object" && typeof r.tag_name === "string" && typeof r.prerelease === "boolean" && typeof r.draft === "boolean" && typeof r.html_url === "string" && Array.isArray(r.assets) && r.assets.every((a: unknown) => a && typeof a === "object" && typeof (a as ReleaseAsset).name === "string" && typeof (a as ReleaseAsset).browser_download_url === "string"));
}
async function readFeed(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("update_feed_empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_FEED_BYTES) { await reader.cancel(); throw new Error("update_feed_too_large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) { buffer.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as unknown;
}

// SemVer precedence, including numeric prerelease identifiers; build metadata is ignored.
export function compareVersions(left: string, right: string): number | null {
  const parse = (s: string) => {
    const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(s);
    return m && m.slice(1, 4).every(n => Number.isSafeInteger(Number(n))) && !m[4]?.split(".").some(p => /^0\d+$/.test(p)) ? m : null;
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return null;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]) ? 1 : -1;
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : a[4] ? -1 : 1;
  const x = a[4].split("."), y = b[4].split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
    if (xn && yn) return x[i].length === y[i].length ? (x[i] > y[i] ? 1 : -1) : x[i].length > y[i].length ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
export function assetName(platform: UpdatePlatform, version: string, arch: string): string | null {
  if (platform === "windows-gui" && arch === "x64") return `DeviceStateConsole-Windows-Setup-v${version}.exe`;
  if (platform === "linux-gui" && arch === "x64") return `DeviceStateConsole-Linux-Install-v${version}.deb`;
  if (platform === "macos-gui" && ["arm64", "x64"].includes(arch)) return `DeviceStateConsole-macOS-${arch}-Install-v${version}.pkg`;
  return null;
}
export function selectUpdate(releases: FeedRelease[], current: string, channel: UpdateChannel, platform: UpdatePlatform, arch: string): UpdateInfo {
  const base: UpdateInfo = { currentVersion: current, currentChannel: channel === "stable" ? "stable" : "test", platform, arch, available: false, latestVersion: null, latestChannel: null, releaseTag: null, releaseUrl: null, notesUrl: null, publishedAt: null, assetName: null, assetUrl: null, assetSize: null, sha256: null, installMode: "installer" };
  const candidates = releases.filter(r => !r.draft && (channel === "preview" || (!r.prerelease && !r.tag_name.split("+")[0].includes("-"))) && compareVersions(r.tag_name, current) === 1).sort((a, b) => compareVersions(b.tag_name, a.tag_name) ?? 0);
  for (const r of candidates) {
    const version = r.tag_name.replace(/^v/, "");
    const name = assetName(platform, version, arch);
    const asset = r.assets.find(a => a.name === name && a.state === "uploaded" && Number.isSafeInteger(a.size) && a.size > 0 && /^sha256:[a-f0-9]{64}$/i.test(a.digest ?? "") && safeAssetUrl(a.browser_download_url, r.tag_name));
    if (!asset) continue;
    return { ...base, available: true, latestVersion: version, latestChannel: r.prerelease || version.split("+")[0].includes("-") ? "test" : "stable", releaseTag: r.tag_name, releaseUrl: r.html_url, notesUrl: r.html_url, publishedAt: r.published_at ?? null, assetName: asset.name, assetUrl: asset.browser_download_url, assetSize: asset.size, sha256: asset.digest!.slice(7) };
  }
  return { ...base, message: candidates.length ? "新版本的适配安装包暂未就绪" : channel === "stable" && current.split("+")[0].includes("-") ? "等待正式通道提供更高版本；不会降级" : "当前通道暂无更高版本" };
}
function safeAssetUrl(value: string, tag: string): boolean {
  try { const u = new URL(value); return u.origin === "https://github.com" && u.pathname.startsWith(`/IGNGserver/guanlan-monitor/releases/download/${encodeURIComponent(tag)}/`) && !u.username && !u.password; } catch { return false; }
}
export class DeviceUpdates {
  private state: State = {};
  private pending: Promise<UpdateInfo> | null = null;
  private loaded = false;
  constructor(private readonly file: string, private readonly current: string, private readonly platform: UpdatePlatform, private readonly arch: string, private readonly request: typeof fetch = fetch, private readonly now = Date.now) {}
  cached(channel: UpdateChannel): UpdateInfo { return selectUpdate(this.state.releases ?? [], this.current, channel, this.platform, this.arch); }
  async check(channel: UpdateChannel, manual = false): Promise<UpdateInfo> {
    if (this.pending) return this.pending.then(() => selectUpdate(this.state.releases ?? [], this.current, channel, this.platform, this.arch));
    this.pending = this.run(channel, manual).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async save() { await mkdir(path.dirname(this.file), { recursive: true }); await writeFile(this.file, JSON.stringify(this.state), { mode: 0o600 }); }
  private async run(channel: UpdateChannel, manual: boolean): Promise<UpdateInfo> {
    if (!this.loaded) { try { const text = await readFile(this.file, "utf8"); if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw new Error("cache_too_large"); const saved: unknown = JSON.parse(text); if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("invalid_cache"); this.state = saved as State; if (this.state.releases !== undefined && !validReleases(this.state.releases)) { this.state.releases = undefined; this.state.etag = undefined; } } catch { this.state = {}; } this.loaded = true; }
    const result = () => selectUpdate(this.state.releases ?? [], this.current, channel, this.platform, this.arch);
    const now = this.now();
    if (now < (this.state.nextRequestAt ?? 0)) return { ...result(), message: this.state.failures ? "更新服务暂不可用，冷却后重试" : "已使用最近检查结果，请稍后重试" };
    if (!manual && now < (this.state.nextAutoAt ?? 0)) return result();
    this.state.nextRequestAt = now + 60_000;
    // Persist before I/O so restarting the app cannot bypass request cooldown.
    await this.save();
    try {
      const response = await this.request(UPDATE_FEED, { headers: this.state.etag ? { "If-None-Match": this.state.etag } : {}, signal: AbortSignal.timeout(20_000) });
      if (response.status !== 304 && !response.ok) {
        const retry = response.headers.get("Retry-After");
        const retryAt = retry ? (/^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry)) : 0;
        const resetAt = Number(response.headers.get("X-RateLimit-Reset") ?? 0) * 1000;
        this.state.nextRequestAt = Math.max(this.state.nextRequestAt ?? 0, retryAt || 0, resetAt);
        throw new Error(`update_feed_http_${response.status}`);
      }
      if (response.status !== 304) {
        const body = await readFeed(response) as { schemaVersion: number; repository: string; generatedAt: string; releases: FeedRelease[] };
        if (!body || body.schemaVersion !== 1 || body.repository !== "IGNGserver/guanlan-monitor" || typeof body.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.generatedAt) || !Number.isFinite(Date.parse(body.generatedAt)) || !validReleases(body.releases)) throw new Error("update_feed_invalid");
        this.state.releases = body.releases;
        this.state.etag = response.headers.get("ETag") ?? undefined;
      } else if (!this.state.releases) throw new Error("update_feed_cache_missing");
      this.state.failures = 0;
      this.state.nextAutoAt = now + 6 * 3600_000 + Math.random() * 30 * 60_000;
      await this.save();
      return result();
    } catch {
      this.state.failures = (this.state.failures ?? 0) + 1;
      this.state.nextRequestAt = Math.max(this.state.nextRequestAt ?? 0, now + Math.min(6 * 3600_000, 60_000 * 2 ** Math.min(this.state.failures, 10)));
      await this.save();
      return { ...result(), message: "更新服务暂不可用，已保留最近检查结果并稍后重试" };
    }
  }
}
