/* Public shell only. Authenticated API, socket and RSC responses never enter
   Cache Storage. Telemetry uses the session-scoped IndexedDB repository. */
"use strict";
const REVISION = new URL(self.location.href).searchParams.get("revision");
const PREFIX = "guanlan-shell-";
const CACHE = PREFIX + REVISION;
const ASSET_MANIFEST = "/pwa-assets.json";
const PUBLIC_FILES = new Set(["/", "/manifest.json", "/favicon.png", "/logo.png"]);
function isPublicAsset(path) {
  return PUBLIC_FILES.has(path) || path.startsWith("/_next/static/");
}
function isPrivateRequest(url, request) {
  return url.pathname.startsWith("/api/") || url.pathname === "/api" || url.pathname.startsWith("/socket.io")
    || url.searchParams.has("_rsc") || request.headers.has("RSC") || request.method !== "GET";
}
async function readManifest(cache) {
  const response = await cache.match(ASSET_MANIFEST);
  return response ? response.json() : null;
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (!REVISION) throw new Error("pwa_revision_missing");
    const response = await fetch(ASSET_MANIFEST, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("pwa_manifest_unavailable");
    const manifest = await response.json();
    if (manifest.revision !== REVISION || !Array.isArray(manifest.assets) || !manifest.assets.includes("/")
      || manifest.assets.some((asset) => typeof asset !== "string" || !asset.startsWith("/") || asset.startsWith("//") || asset.includes("?") || !isPublicAsset(asset))) throw new Error("pwa_manifest_mismatch");
    const cache = await caches.open(CACHE);
    try {
      // A failed asset rejects the entire candidate. The active worker/cache
      // stays in place; installation never switches to a partial shell.
      for (let offset = 0; offset < manifest.assets.length; offset += 6) {
        await Promise.all(manifest.assets.slice(offset, offset + 6).map(async (asset) => {
          const resource = await fetch(asset, { cache: "reload", credentials: "omit" });
          if (!resource.ok || resource.type === "opaque") throw new Error("pwa_asset_unavailable");
          if (asset === "/") {
            const html = await resource.clone().text();
            if (!html.includes(`name="guanlan-pwa-revision" content="${REVISION}"`)) throw new Error("pwa_shell_mismatch");
          }
          await cache.put(asset, resource);
        }));
      }
      await cache.put(ASSET_MANIFEST, new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }));
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Keep the previous generation for an already-open tab's lazy chunks.
    const keys = (await caches.keys()).filter((key) => key.startsWith(PREFIX));
    const previous = keys.filter((key) => key !== CACHE).slice(-1);
    await Promise.all(keys.filter((key) => key !== CACHE && !previous.includes(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url, request)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => { if (!response.ok) throw new Error("navigation_unavailable"); return response; }).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match("/")) || Response.error();
    }));
    return;
  }
  if (!isPublicAsset(url.pathname) || url.pathname === "/") return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const manifest = await readManifest(cache);
    if (manifest?.assets.includes(url.pathname)) {
      const saved = await cache.match(url.pathname);
      if (saved) return saved;
    }
    // A controlled old tab can still request a chunk from the previous build.
    if (url.pathname.startsWith("/_next/static/")) {
      for (const key of (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE)) {
        const saved = await (await caches.open(key)).match(url.pathname);
        if (saved) return saved;
      }
    }
    return fetch(request);
  })());
});
