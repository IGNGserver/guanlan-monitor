import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spacing and type on the shared console come from two scales in
 * `packages/console-ui/src/m3e/tokens.css`: `--md-sys-space-*` (a 4px rhythm)
 * and `--md-sys-typescale-*`. Before this check the stylesheets carried 34
 * different literal gap/padding/margin values and a dozen one-off font sizes,
 * which is why cards, sections and rows never lined up.
 *
 * A literal is allowed only where a token cannot say it: hairline spacing
 * (0–2px), structural reservations of 64px and up (such as the macOS
 * traffic-light inset), and display-sized figures of 32px and up.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roots = ["../packages/console-ui/src", "../apps/web/src"].map((dir) => path.resolve(__dirname, dir));
const spacing = /(?:^|[;{\s])((?:row-|column-)?gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?)\s*:\s*([^;{}]+)/g;
const fontSize = /(?:^|[;{\s])(font-size)\s*:\s*([^;{}]+)/g;
const pixels = (number, unit) => Number(number) * (unit === "rem" || unit === "em" ? 16 : 1);

const violations = [];
function check(file, lineNumber, line, pattern, allowed, hint) {
  for (const [, property, value] of line.matchAll(pattern)) {
    for (const [, number, unit] of value.matchAll(/-?(\d+(?:\.\d+)?)(px|rem|em)\b/g)) {
      if (!allowed(pixels(number, unit))) violations.push(`${path.relative(process.cwd(), file)}:${lineNumber}  ${property}: ${value.trim()}  → ${hint}`);
    }
  }
}
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") scan(full);
      continue;
    }
    if (!/\.(css|scss)$/.test(entry.name)) continue;
    fs.readFileSync(full, "utf8").split("\n").forEach((line, index) => {
      check(full, index + 1, line, spacing, (px) => px <= 2 || px >= 64, "var(--md-sys-space-*)");
      // Fallbacks inside var() and clamp() bounds are exempt: the token decides.
      if (!/var\(|clamp\(/.test(line)) check(full, index + 1, line, fontSize, (px) => px >= 32, "var(--md-sys-typescale-*-size)");
    });
  }
}
roots.forEach(scan);

if (violations.length) {
  console.error(`[check:ui-scale] ${violations.length} literal value(s) off the spacing or type scale:`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("[check:ui-scale] spacing and font sizes use the design scales");
