import { readFile } from "node:fs/promises";

const rootVersion = (await readFile(new URL("../VERSION", import.meta.url), "utf8")).trim();
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

console.log(`Version consistency check passed: ${rootVersion}`);
