import type {
  ReleaseChannel,
  SystemVersionInfo,
  UpdateInfo,
  UpdatePlatform
} from "@dsc/shared";
import { env } from "./config.js";

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url: string;
  published_at?: string | null;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubAsset[];
}

interface CachedReleases {
  expiresAt: number;
  releases: GitHubRelease[];
}

const releaseVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/;
let releaseCache: CachedReleases | null = null;
let releaseRequest: Promise<GitHubRelease[]> | null = null;

export function compareVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (let index = 0; index < parsedLeft.length; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) {
      return parsedLeft[index] > parsedRight[index] ? 1 : -1;
    }
  }
  return 0;
}

export function isStrictlyNewerVersion(candidate: string, current: string) {
  return compareVersions(candidate, current) === 1;
}

export function getSystemVersionInfo(): SystemVersionInfo {
  return {
    version: env.DSC_VERSION,
    channel: env.DSC_RELEASE_CHANNEL,
    repository: env.DSC_RELEASE_REPOSITORY
  };
}

export async function getUpdateInfo(input: {
  platform: UpdatePlatform;
  currentVersion?: string;
  currentChannel?: ReleaseChannel;
  arch?: string;
}): Promise<UpdateInfo> {
  const currentVersion = input.currentVersion?.trim() || env.DSC_VERSION;
  const currentChannel = input.currentChannel ?? env.DSC_RELEASE_CHANNEL;
  const base = {
    currentVersion,
    currentChannel,
    platform: input.platform,
    arch: input.arch,
    available: false,
    latestVersion: null,
    latestChannel: null,
    releaseTag: null,
    releaseUrl: null,
    notesUrl: null,
    publishedAt: null,
    assetName: null,
    assetUrl: null,
    assetSize: null,
    sha256: null,
    installMode: installModeFor(input.platform)
  } satisfies Omit<UpdateInfo, "message">;

  if (!parseVersion(currentVersion)) {
    return { ...base, message: "current_version_unrecognized" };
  }

  const releases = await getReleases();
  const candidate = releases
    .filter((release) => !release.draft)
    .map((release) => ({ release, version: parseVersion(release.tag_name) }))
    .filter((item): item is { release: GitHubRelease; version: [number, number, number] } => item.version !== null)
    .filter(({ release, version }) => {
      if (!isStrictlyNewerVersion(version.join("."), currentVersion)) return false;
      if (currentChannel === "stable" && release.prerelease) return false;
      return true;
    })
    .sort((left, right) => {
      const versionOrder = compareVersions(right.version.join("."), left.version.join(".")) ?? 0;
      if (versionOrder !== 0) return versionOrder;
      return Number(left.release.prerelease) - Number(right.release.prerelease);
    })[0]?.release;

  if (!candidate) {
    return { ...base, message: "up_to_date" };
  }

  const candidateVersion = normalizeVersion(candidate.tag_name);
  const assetName = assetNameFor(input.platform, candidateVersion);
  const asset = assetName ? candidate.assets.find((item) => item.name === assetName) : undefined;
  const sha256 = asset ? await resolveSha256(candidate, asset) : null;
  const releaseChannel: ReleaseChannel = candidate.prerelease ? "test" : "stable";

  return {
    ...base,
    available: true,
    latestVersion: candidateVersion,
    latestChannel: releaseChannel,
    releaseTag: candidate.tag_name,
    releaseUrl: candidate.html_url,
    notesUrl: candidate.html_url,
    publishedAt: candidate.published_at ?? null,
    assetName: asset?.name ?? null,
    assetUrl: asset?.browser_download_url ?? (input.platform === "ios" ? env.DSC_IOS_UPDATE_URL ?? null : null),
    assetSize: asset?.size ?? null,
    sha256,
    installMode: input.platform === "ios" ? "store" : base.installMode,
    message: asset || input.platform === "hub" || input.platform === "web" || input.platform === "ios"
      ? undefined
      : "asset_not_found"
  };
}

function parseVersion(value: string): [number, number, number] | null {
  const match = releaseVersionPattern.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/, "");
}

async function getReleases() {
  const now = Date.now();
  if (releaseCache && releaseCache.expiresAt > now) return releaseCache.releases;
  if (releaseRequest) return releaseRequest;

  releaseRequest = fetch(releaseApiUrl(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "device-state-console-update-checker"
    }
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`github_release_api_${response.status}`);
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("github_release_api_invalid_response");
      return body as GitHubRelease[];
    })
    .then((releases) => {
      releaseCache = {
        releases,
        expiresAt: Date.now() + env.DSC_UPDATE_CACHE_SECONDS * 1000
      };
      return releases;
    })
    .finally(() => {
      releaseRequest = null;
    });

  return releaseRequest;
}

function releaseApiUrl() {
  return env.DSC_RELEASE_API_URL ??
    `https://api.github.com/repos/${env.DSC_RELEASE_REPOSITORY}/releases?per_page=100`;
}

function assetNameFor(platform: UpdatePlatform, version: string) {
  switch (platform) {
    case "windows-gui":
      return `DeviceStateConsole-Windows-GUI-Setup-v${version}.exe`;
    case "linux-gui":
      return `DeviceStateConsole-Linux-GUI-Install-v${version}.deb`;
    case "android":
      return `DeviceStateConsole-Android-v${version}.apk`;
    case "windows-cli":
      return `DeviceStateConsole-Windows-CLI-Install-v${version}.zip`;
    case "linux-cli":
      return `DeviceStateConsole-Linux-CLI-Install-v${version}.zip`;
    default:
      return null;
  }
}

function installModeFor(platform: UpdatePlatform): UpdateInfo["installMode"] {
  switch (platform) {
    case "windows-gui":
      return "installer";
    case "linux-gui":
      return "package";
    case "android":
      return "apk";
    case "windows-cli":
    case "linux-cli":
      return "cli";
    case "hub":
    case "web":
      return "hub";
    case "ios":
      return "store";
    default:
      return "none";
  }
}

async function resolveSha256(release: GitHubRelease, asset: GitHubAsset) {
  const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
  if (digest) return digest.toLowerCase();

  const checksumAsset = release.assets.find((item) =>
    item.name === `${asset.name}.sha256` || item.name === `${asset.name}.sha256.txt`
  );
  if (!checksumAsset) return null;

  try {
    const response = await fetch(checksumAsset.browser_download_url, {
      headers: { "User-Agent": "device-state-console-update-checker" }
    });
    if (!response.ok) return null;
    return (await response.text()).match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
