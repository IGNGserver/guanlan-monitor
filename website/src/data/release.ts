import { ASSETS, FALLBACK_RELEASE, REPO, REPO_URL, type ReleaseInfo } from './product';

interface GhAsset { name: string; browser_download_url: string; size: number }
interface GhRelease { tag_name: string; html_url: string; published_at: string; draft: boolean; prerelease: boolean; assets: GhAsset[] }

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const releaseTagUrl = (tag: string) => `${REPO_URL}/releases/tag/${encodeURIComponent(tag)}`;
const releaseAssetUrl = (tag: string, name: string) => `${REPO_URL}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

/**
 * 观澜当前以测试版（GitHub prerelease）持续发布；GitHub 上标记为 Latest 的仍是旧命名规则的
 * v0.2.271。因此这里取「最新一个非 draft、且资产命名符合产品 README 发布规则的发布」，
 * 并原样暴露 prerelease 标记，由页面如实标注通道。
 */
export function pickRelease(list: GhRelease[]): ReleaseInfo | null {
  for (const rel of list) {
    if (rel.draft || !SAFE_SEGMENT.test(rel.tag_name)) continue;
    const assets: ReleaseInfo['assets'] = {};
    for (const spec of ASSETS) {
      const hit = rel.assets.find((a) => spec.pattern.test(a.name) && SAFE_SEGMENT.test(a.name));
      if (hit) assets[spec.key] = { name: hit.name, size: hit.size, url: releaseAssetUrl(rel.tag_name, hit.name) };
    }
    if (assets.winSetup && assets.deb && assets.apk) {
      return {
        tag: rel.tag_name,
        url: releaseTagUrl(rel.tag_name),
        publishedAt: rel.published_at,
        prerelease: rel.prerelease,
        assets,
      };
    }
  }
  return null;
}

let cached: Promise<ReleaseInfo> | undefined;

/** 构建时调用一次；网络失败或 GUANLAN_OFFLINE=1 时使用 product.ts 中核对过的烘焙值。 */
export function getRelease(): Promise<ReleaseInfo> {
  cached ??= (async () => {
    if (process.env.GUANLAN_OFFLINE === '1') return FALLBACK_RELEASE;
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'guanlan-website-build' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      // 产品可能连续发布多个测试版；分页查找能避免正式版被挤出第一页后消失。
      for (let page = 1; page <= 5; page++) {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30&page=${page}`, {
          headers,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const list = (await res.json()) as GhRelease[];
        const release = pickRelease(list);
        if (release) return release;
        if (list.length < 30) break;
      }
      return FALLBACK_RELEASE;
    } catch (err) {
      console.warn(`[release] 无法读取 ${REPO} 的发布信息，使用烘焙值 ${FALLBACK_RELEASE.tag}：${(err as Error).message}`);
      return FALLBACK_RELEASE;
    }
  })();
  return cached;
}

export function formatSize(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
