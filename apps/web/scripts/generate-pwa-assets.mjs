import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { WEB_PWA_REVISION } from "../pwa-build.mjs";
import { classifyPwaAssets } from "./pwa-assets.mjs";
import { buildServiceWorker } from "./build-service-worker.mjs";

const paths = [];
const walk = (path, url) => {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (item.isDirectory()) walk(join(path, item.name), `${url}/${item.name}`);
    else if (item.isFile()) paths.push(`${url}/${item.name}`);
  }
};
walk(".next/static", "/_next/static");
const { assets, runtimeAssets } = classifyPwaAssets(paths);
const icons = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")).icons.map((icon) => icon.src);
for (const icon of icons) if (!runtimeAssets.includes(icon)) runtimeAssets.push(icon);
const graph = { revision: WEB_PWA_REVISION, assets, runtimeAssets };
writeFileSync("public/pwa-assets.json", JSON.stringify(graph));
const filePath = (url) => url === "/" ? (process.env.DSC_STATIC_EXPORT === "true" ? "out/index.html" : ".next/server/app/index.html")
  : url.startsWith("/_next/") ? url.replace("/_next/", ".next/") : `public${url}`;
const entries = assets.map((url) => {
  const bytes = readFileSync(filePath(url));
  const digest = createHash("sha256").update(bytes).digest();
  return { url, revision: /^\/_next\/static\/.*[a-f0-9]{8,}.*\.(?:js|css|woff2?|png|webp|svg)$/.test(url) ? null : digest.toString("hex"), integrity: `sha256-${digest.toString("base64")}` };
});
await buildServiceWorker({ output: resolve("public/sw.js"), entries, runtimeAssets, revision: WEB_PWA_REVISION, temporaryDirectory: resolve(".next/pwa") });
if (process.env.DSC_STATIC_EXPORT === "true") for (const file of ["pwa-assets.json", "sw.js"]) copyFileSync(`public/${file}`, `out/${file}`);
const bytes = (list) => list.filter((path) => path !== "/").reduce((total, path) => total + statSync(filePath(path)).size, 0);
console.log(`Prepared Workbox shell: ${assets.length} core assets / ${bytes(assets)} bytes, ${runtimeAssets.length} runtime assets / ${bytes(runtimeAssets)} bytes, revision ${WEB_PWA_REVISION}`);
