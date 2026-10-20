import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_PWA_REVISION } from "../pwa-build.mjs";
import { classifyPwaAssets } from "./pwa-assets.mjs";
const paths = [];
const walk = (path, url) => {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (item.isDirectory()) walk(join(path, item.name), `${url}/${item.name}`);
    else if (item.isFile()) paths.push(`${url}/${item.name}`);
  }
};
walk(".next/static", "/_next/static");
const { assets, runtimeAssets } = classifyPwaAssets(paths);
// CI-only output. The Docker image copies public/ after this step.
writeFileSync("public/pwa-assets.json", JSON.stringify({ revision: WEB_PWA_REVISION, assets, runtimeAssets }));
const bytes = (list) => list.filter((path) => path !== "/").reduce((total, path) => total + statSync(path.startsWith("/_next/") ? path.replace("/_next/", ".next/") : `public${path}`).size, 0);
console.log(`Prepared PWA shell: ${assets.length} core assets / ${bytes(assets)} raw bytes (HTML excluded), ${runtimeAssets.length} runtime assets / ${bytes(runtimeAssets)} raw bytes, revision ${WEB_PWA_REVISION}`);
