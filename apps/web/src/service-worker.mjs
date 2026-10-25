/* Workbox owns the public precache graph; authenticated data stays in the
 * session-scoped IndexedDB repository and never enters Cache Storage. */
import { PrecacheController } from "workbox-precaching";

const REVISION = __GUANLAN_REVISION__;
const PREFIX = "guanlan-shell-";
const CACHE = PREFIX + __GUANLAN_CACHE_GENERATION__;
const entries = self.__WB_MANIFEST;
const ASSETS = new Set(entries.map((entry) => new URL(typeof entry === "string" ? entry : entry.url, self.location.origin).pathname));
const RUNTIME_ASSETS = new Set(__GUANLAN_RUNTIME_ASSETS__);
const ASSET_MANIFEST = "/pwa-assets.json";
function isPrivateRequest(url, request) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")
    || url.search || request.headers.has("RSC") || request.headers.has("Authorization") || request.method !== "GET";
}
function isHashedAsset(path) {
  if (!path.startsWith("/_next/static/") && !/^\/icons\/[a-f0-9]{12}\//.test(path)) return false;
  const file = path.slice(path.lastIndexOf("/") + 1);
  return /^\/icons\/[a-f0-9]{12}\//.test(path) || (/\.(js|css|woff2?|png|webp|svg)$/.test(file)
    && (file.match(/(?:^|[-.])[a-f0-9]{8,}(?=[-.])/gi) || []).some((hash) => /[a-f]/i.test(hash)));
}
function usableAsset(path, response) {
  if (!response.ok || response.type === "opaque" || response.redirected) return false;
  const type = response.headers.get("Content-Type") || "";
  if (path.endsWith(".js") && !/(?:javascript|ecmascript)/i.test(type)) return false;
  if (path.endsWith(".css") && !/text\/css/i.test(type)) return false;
  if (path.endsWith(".png") && !/image\/png/i.test(type)) return false;
  return true;
}
async function previousAsset(path) {
  if (!isHashedAsset(path)) return null;
  for (const key of (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE).reverse()) {
    const previous = await caches.open(key);
    const graph = await previous.match(ASSET_MANIFEST);
    const manifest = graph ? await graph.json() : null;
    if (![...(manifest?.assets || []), ...(manifest?.runtimeAssets || [])].includes(path)) continue;
    const response = await previous.match(path);
    if (response && usableAsset(path, response)) return response;
  }
  return null;
}
const precache = new PrecacheController({ cacheName: CACHE, plugins: [{
  requestWillFetch: async ({ request }) => new Request(request, { credentials: "omit", cache: "reload" }),
  // Reuse only immutable bytes named by both generations. The document and
  // manifest must always be validated as part of the candidate installation.
  cacheWillUpdate: async ({ request, response }) => {
    const path = new URL(request.url).pathname;
    if (!usableAsset(path, response)) throw new Error("pwa_asset_unavailable");
    if (path === "/" && !(await response.clone().text()).includes(`name="guanlan-pwa-revision" content="${REVISION}"`)) throw new Error("pwa_shell_mismatch");
    return response;
  }
}] });
precache.addToCacheList(entries);
async function saveGraph() {
  const cache = await caches.open(CACHE);
  await cache.put(ASSET_MANIFEST, new Response(JSON.stringify({ revision: REVISION, assets: [...ASSETS], runtimeAssets: [...RUNTIME_ASSETS] }), { headers: { "Content-Type": "application/json" } }));
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const safePath = (path) => typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !/[?#\\]/.test(path)
      && new URL(path, self.location.origin).pathname === path && (path === "/" || path === "/manifest.webmanifest" || path === "/favicon.png" || path === "/logo.png" || path.startsWith("/_next/static/") || /^\/icons\/[a-f0-9]{12}\/[^/]+\.png$/.test(path));
    if ([...ASSETS, ...RUNTIME_ASSETS].some((path) => !safePath(path))) throw new Error("pwa_manifest_mismatch");
    try {
      const candidate = await caches.open(CACHE);
      for (const path of ASSETS) {
        const saved = await previousAsset(path);
        if (saved) await candidate.put(precache.getCacheKeyForURL(path), saved);
      }
      await precache.install(event);
      await saveGraph();
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await precache.activate(event);
    // Workbox removes auxiliary keys during activate; restore our declared
    // graph so a later generation can safely reuse only these immutable URLs.
    await saveGraph();
    // A user can accept an update while another tab still needs older lazy
    // chunks. Only a natural activation without windows may remove old graphs.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (!windows.length) await Promise.all((await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url, request)) return;
  if (request.mode === "navigate") {
    if (url.pathname !== "/" && !/^\/devices\/[^/]+\/?$/.test(url.pathname)) return;
    event.respondWith((async () => {
      const shell = await precache.matchPrecache("/");
      if (shell) return shell;
      try { return await fetch(request); } catch { return Response.error(); }
    })());
    return;
  }
  if (!ASSETS.has(url.pathname) && !RUNTIME_ASSETS.has(url.pathname) && !isHashedAsset(url.pathname)) return;
  event.respondWith((async () => {
    const saved = await precache.matchPrecache(url.pathname);
    if (saved) return saved;
    const previous = await previousAsset(url.pathname);
    if (previous) return previous;
    if (RUNTIME_ASSETS.has(url.pathname)) {
      const cache = await caches.open(CACHE);
      const runtime = await cache.match(url.pathname);
      if (runtime) return runtime;
      const response = await fetch(request, { credentials: "omit" });
      if (usableAsset(url.pathname, response)) await cache.put(url.pathname, response.clone());
      return response;
    }
    return fetch(request);
  })());
});
