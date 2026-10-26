import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { buildServiceWorker } from "./build-service-worker.mjs";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engineName = process.argv.includes("--webkit") ? "webkit" : "chromium";
const output = resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || ".next/pwa-browser");
await mkdir(dirname(output), { recursive: true });
const temporary = await mkdtemp(output + "-");
const chunks = { a: "/_next/static/chunks/app-abcdef0123456789.js", b: "/_next/static/chunks/app-0123456789abcdef.js", c: "/_next/static/chunks/app-deadbeef01234567.js" };
const workers = {};
const generations = {};
const shell = (version) => `<html><head><meta name="guanlan-pwa-revision" content="same-source"></head><body><h1>Shell ${version}</h1><input aria-label="Draft"></body></html>`;
for (const revision of ["a", "b", "c"]) {
  const worker = join(temporary, `sw-${revision}.js`);
  const { generation } = await buildServiceWorker({ output: worker, entries: [{ url: "/", revision, integrity: `sha256-${createHash("sha256").update(shell(revision)).digest("base64")}` }, { url: "/manifest.webmanifest", revision }, { url: chunks[revision], revision: null }], revision: "same-source", temporaryDirectory: join(temporary, revision) });
  workers[revision] = await readFile(worker);
  generations[revision] = generation;
}
let revision = "a";
let unreachable = false;
let staleShell = false;
const requests = [];
const server = createServer((req, res) => {
  if (unreachable) { req.socket.destroy(); return; }
  const path = new URL(req.url, "http://fixture").pathname;
  requests.push({ path, cookie: req.headers.cookie || "" });
  res.setHeader("Cache-Control", "no-store");
  if (path === "/sw.js") { res.setHeader("Content-Type", "application/javascript"); return res.end(workers[revision]); }
  if (path === "/manifest.webmanifest") { res.setHeader("Content-Type", "application/manifest+json"); return res.end(JSON.stringify({ id: "/", start_url: "/", scope: "/", display: "standalone", name: "PWA regression" })); }
  if (path.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ private: true })); }
  if (path === "/" || path.startsWith("/devices/")) { res.setHeader("Content-Type", "text/html"); return res.end(shell(staleShell ? "a" : revision)); }
  if (path === chunks.c) { res.statusCode = 404; return res.end("missing candidate resource"); }
  if (Object.values(chunks).includes(path)) { res.setHeader("Content-Type", "application/javascript"); return res.end(`/* ${path} */`); }
  res.statusCode = 404; res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await (engineName === "webkit" ? webkit : chromium).launch({ headless: true, ...(engineName === "webkit" && process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
async function setOffline(context, value) {
  // Playwright WebKit offline navigation has an engine limitation. Reject
  // origin connections instead; an uncontrolled page is a required control.
  if (engineName === "webkit") unreachable = value;
  else await context.setOffline(value);
}
const checks = [];
try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  await context.addCookies([{ name: "audit", value: "fixture-only", url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(base);
  requests.length = 0;
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.ok(requests.filter((item) => item.path !== "/sw.js" && item.path !== "/favicon.ico").every((item) => !item.cookie), "precache fetches must omit cookies");
  checks.push("atomic initial installation without credentials");
  await page.evaluate(() => fetch("/api/private"));
  assert.equal(await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((req) => req.url)))).flat().some((url) => new URL(url).pathname.startsWith("/api/"))), false);
  checks.push("private API bypasses Cache Storage");
  await setOffline(context, true);
  await page.reload();
  assert.equal(await page.locator("h1").textContent(), "Shell a");
  if (engineName === "webkit") {
    const control = await browser.newContext({ serviceWorkers: "block" });
    const uncontrolled = await control.newPage();
    await assert.rejects(uncontrolled.goto(base, { timeout: 7000 }));
    await control.close();
  }
  checks.push(engineName === "webkit" ? "cached shell survives an unreachable origin; uncontrolled page fails" : "cached shell opens offline");
  await setOffline(context, false);
  revision = "b";
  staleShell = true;
  const mixed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const worker = registration.installing;
    if (!worker) return "redundant";
    if (["installed", "redundant"].includes(worker.state)) return worker.state;
    return new Promise((resolve) => worker.addEventListener("statechange", () => { if (["installed", "redundant"].includes(worker.state)) resolve(worker.state); }));
  });
  assert.equal(mixed, "redundant");
  assert.equal(await page.evaluate(async (name) => (await caches.keys()).includes(name), `guanlan-shell-${generations.a}`), true);
  assert.equal(await page.evaluate(async (name) => (await caches.keys()).includes(name), `guanlan-shell-${generations.b}`), false);
  checks.push("same-source rebuild rejects stale HTML without deleting the active generation");
  staleShell = false;
  await page.evaluate(async () => {
    window.__pwaRegistration = await navigator.serviceWorker.getRegistration();
    await window.__pwaRegistration.update();
  });
  // Keep polling synchronous: older Playwright runners treat a returned Promise
  // as truthy before its boolean value settles, racing the installing worker.
  await page.waitForFunction(() => !!window.__pwaRegistration.waiting);
  assert.equal(await page.locator("h1").textContent(), "Shell a");
  checks.push("a complete new graph waits for user activation");
  await page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration()).waiting;
    if (!waiting) throw new Error("candidate no longer waiting");
    await new Promise((resolve) => { navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }); waiting.postMessage({ type: "ACTIVATE_UPDATE" }); });
  });
  await setOffline(context, true);
  assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, chunks.a), 200);
  await page.reload();
  assert.equal(await page.locator("h1").textContent(), "Shell b");
  checks.push("accepted update keeps old-tab immutable chunks and opens its own shell");
  await setOffline(context, false);
  revision = "c";
  const failed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    const worker = registration.installing;
    if (!worker) return "redundant";
    if (["installed", "redundant"].includes(worker.state)) return worker.state;
    return new Promise((resolve) => worker.addEventListener("statechange", () => { if (["installed", "redundant"].includes(worker.state)) resolve(worker.state); }));
  });
  assert.equal(failed, "redundant");
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting === null), true);
  assert.equal(await page.evaluate(async (name) => (await caches.keys()).includes(name), `guanlan-shell-${generations.c}`), false);
  await setOffline(context, true);
  await page.reload();
  assert.equal(await page.locator("h1").textContent(), "Shell b");
  checks.push("a partial update is rejected and the working version remains offline-capable");
  await context.close();
  await writeFile(join(temporary, "report.json"), JSON.stringify({ engine: engineName, checks }, null, 2));
  console.log(JSON.stringify({ engine: engineName, checks, output: temporary }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
