import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.resolve(process.argv[2] ?? "release/windows-desktop/win-unpacked");
const expectedVersion = (process.argv[3] ?? fs.readFileSync(path.join(projectRoot, "VERSION"), "utf8")).trim();

if (!expectedVersion) {
  console.error("❌ Electron artifact version: expected version is empty.");
  process.exit(1);
}

const asarPath = fs.statSync(artifactRoot, { throwIfNoEntry: false })?.isDirectory()
  ? path.join(artifactRoot, "resources", "app.asar")
  : artifactRoot;
const unpackedManifestPath = path.join(artifactRoot, "resources", "app", "package.json");
const directManifestPath = path.join(artifactRoot, "package.json");

function assertManifestVersion(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.version !== expectedVersion) {
    throw new Error(`manifest ${manifestPath} reports ${manifest.version ?? "no version"}, expected ${expectedVersion}`);
  }
  console.log(`[verify:electron-artifact-version] ${path.relative(projectRoot, manifestPath)} reports ${expectedVersion}.`);
}

try {
  if (fs.existsSync(unpackedManifestPath)) {
    assertManifestVersion(unpackedManifestPath);
    process.exit(0);
  }
  if (fs.existsSync(directManifestPath) && fs.statSync(artifactRoot).isDirectory()) {
    assertManifestVersion(directManifestPath);
    process.exit(0);
  }
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Electron app.asar not found at ${asarPath}`);
  }
  const asarText = fs.readFileSync(asarPath).toString("latin1");
  const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionPattern = new RegExp(`\"version\"\\s*:\\s*\"${escapedVersion}\"`);
  if (!versionPattern.test(asarText)) {
    throw new Error(`resources/app.asar does not contain package version ${expectedVersion}`);
  }
  console.log(`[verify:electron-artifact-version] ${path.relative(projectRoot, asarPath)} contains package version ${expectedVersion}.`);
} catch (error) {
  console.error(`❌ Electron artifact version: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
