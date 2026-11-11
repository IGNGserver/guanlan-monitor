import { readdir } from "node:fs/promises";

/**
 * 发布说明的落点守卫。
 *
 * 每版说明放在 .github/release-notes/<tag>.md，由 release-test.yml 读取后作为
 * Release 正文。历史上一版一个 release-notes-vX.Y.Z.md 堆在仓库根目录，攒了 399 个，
 * 所以这里守住根目录不再长出这类文件。
 */
const repoRoot = new URL("../", import.meta.url);
const notesDir = ".github/release-notes";

const rootEntries = await readdir(repoRoot);
const stray = rootEntries.filter((name) => /^release-notes-.*\.md$/i.test(name)).sort();
if (stray.length > 0) {
  throw new Error(
    `发布说明不能放在仓库根目录：${stray.join("、")}。请移到 ${notesDir}/<tag>.md。`,
  );
}

const notes = (await readdir(new URL(`${notesDir}/`, repoRoot)))
  .filter((name) => name !== "README.md")
  .sort();
const invalid = notes.filter((name) => !/^v\d+\.\d+\.\d+\.md$/.test(name));
if (invalid.length > 0) {
  throw new Error(`${notesDir}/ 只能放 <tag>.md（例如 v3.0.174.md）：${invalid.join("、")}`);
}

console.log(`release notes layout ok: ${notes.length} 份说明在 ${notesDir}/，根目录无残留`);
