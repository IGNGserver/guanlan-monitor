import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootVersion = (await readFile(new URL("../VERSION", import.meta.url), "utf8")).trim();
const rootParts = rootVersion.split(".").map(Number);
const packagePaths = [
  "../package.json",
  "../apps/server/package.json",
  "../apps/web/package.json",
  "../packages/shared/package.json",
];

if (!/^\d+\.\d+\.\d+$/.test(rootVersion)) {
  throw new Error(`VERSION must use semantic versioning: ${rootVersion}`);
}

for (const packagePath of packagePaths) {
  const packageJson = JSON.parse(await readFile(new URL(packagePath, import.meta.url), "utf8"));
  if (packageJson.version !== rootVersion) {
    throw new Error(`${packagePath} version ${packageJson.version} does not match VERSION ${rootVersion}`);
  }
}

try {
  const { stdout } = await execFileAsync("git", ["tag", "--list", "v*.*.*"]);
  const previousVersions = stdout
    .split(/\r?\n/)
    .map((tag) => tag.replace(/^v/, "").trim())
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .map((version) => version.split(".").map(Number))
    .filter(([major, minor, patch]) => major < rootParts[0] || (major === rootParts[0] && (minor < rootParts[1] || (minor === rootParts[1] && patch < rootParts[2]))));

  if (previousVersions.length > 0) {
    const [major, minor, patch] = previousVersions.sort((a, b) => {
      for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return b[index] - a[index];
      }
      return 0;
    })[0];
    if (rootParts[0] !== major || rootParts[1] !== minor || rootParts[2] <= patch) {
      throw new Error(`VERSION may only increment the patch number within ${major}.${minor}.x; got ${rootVersion}`);
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT" && !String(error?.message ?? "").startsWith("spawn git ENOENT")) throw error;
}

console.log(`Version consistency check passed: ${rootVersion}`);
