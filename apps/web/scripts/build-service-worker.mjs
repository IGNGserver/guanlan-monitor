import { createHash } from "node:crypto";
import { readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { injectManifest } from "workbox-build";
import { build } from "esbuild";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
export async function buildServiceWorker({ output, entries, runtimeAssets = [], revision, temporaryDirectory }) {
  const generation = createHash("sha256").update(JSON.stringify({ revision, entries, runtimeAssets })).digest("hex").slice(0, 20);
  await mkdir(temporaryDirectory, { recursive: true });
  const intermediate = join(temporaryDirectory, "injected-worker.mjs");
  await injectManifest({
    swSrc: join(webRoot, "src/service-worker.mjs"), swDest: intermediate,
    globDirectory: webRoot, globPatterns: [], additionalManifestEntries: entries
  });
  await build({
    stdin: { contents: await readFile(intermediate, "utf8"), resolveDir: webRoot, sourcefile: "service-worker.mjs" },
    bundle: true, outfile: output, format: "iife", target: "safari15", minify: true,
    define: { __GUANLAN_REVISION__: JSON.stringify(revision), __GUANLAN_CACHE_GENERATION__: JSON.stringify(generation), __GUANLAN_RUNTIME_ASSETS__: JSON.stringify(runtimeAssets), "process.env.NODE_ENV": '"production"' },
    legalComments: "inline"
  });
  await rm(intermediate);
  return { generation };
}
