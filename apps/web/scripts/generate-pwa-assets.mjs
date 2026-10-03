import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEB_PWA_REVISION } from "../pwa-build.mjs";
const assets = ["/", "/manifest.json", "/favicon.png", "/logo.png"];
const walk = (path, url) => {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (item.isDirectory()) walk(join(path, item.name), `${url}/${item.name}`);
    else if (item.isFile() && !item.name.endsWith(".map")) assets.push(`${url}/${item.name}`);
  }
};
walk(".next/static", "/_next/static");
// CI-only output. The Docker image copies public/ after this step.
writeFileSync("public/pwa-assets.json", JSON.stringify({ revision: WEB_PWA_REVISION, assets: assets.sort() }));
console.log(`Prepared PWA shell: ${assets.length} public assets, revision ${WEB_PWA_REVISION}`);
