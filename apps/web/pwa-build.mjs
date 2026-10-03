import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
export function pwaRevision() {
  const hash = createHash("sha256");
  const files = [];
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(directory, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && item.name !== "pwa-assets.json") files.push(full);
    }
  };
  walk(join(webRoot, "src"));
  walk(join(webRoot, "public"));
  walk(join(webRoot, "scripts"));
  walk(resolve(webRoot, "../../packages/shared/src"));
  walk(resolve(webRoot, "../../packages/console-ui/src"));
  for (const file of ["package.json", "next.config.mjs", "pwa-build.mjs", "../../pnpm-lock.yaml", "../../VERSION"]) files.push(join(webRoot, file));
  for (const file of files.sort()) hash.update(relative(webRoot, file)).update(readFileSync(file));
  hash.update(process.env.DSC_RELEASE_CHANNEL === "stable" ? "stable" : "test");
  return hash.digest("hex").slice(0, 20);
}
export const WEB_PWA_REVISION = pwaRevision();
