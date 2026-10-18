import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spacing on the shared console comes from one 4px scale (`--md-sys-space-*` in
 * `packages/console-ui/src/m3e/tokens.css`). Before this check the stylesheets
 * carried 34 different literal gap/padding/margin values, which is why cards,
 * sections and rows never lined up. A literal is allowed only where a token
 * cannot say it: hairlines (0–2px) and structural reservations of 64px and up,
 * such as the macOS traffic-light inset.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const roots = ["../packages/console-ui/src", "../apps/web/src"].map((dir) => path.resolve(__dirname, dir));
const declaration = /(?:^|[;{\s])((?:row-|column-)?gap|padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?)\s*:\s*([^;{}]+)/g;
const isAllowed = (px) => px <= 2 || px >= 64;

const violations = [];
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") scan(full);
      continue;
    }
    if (!/\.(css|scss)$/.test(entry.name)) continue;
    const lines = fs.readFileSync(full, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [, property, value] of line.matchAll(declaration)) {
        for (const [, number] of value.matchAll(/-?(\d+(?:\.\d+)?)px\b/g)) {
          if (!isAllowed(Number(number))) violations.push(`${path.relative(process.cwd(), full)}:${index + 1}  ${property}: ${value.trim()}`);
        }
      }
    });
  }
}
roots.forEach(scan);

if (violations.length) {
  console.error(`[check:ui-spacing] ${violations.length} literal spacing value(s) off the token scale. Use var(--md-sys-space-*):`);
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log("[check:ui-spacing] gap/padding/margin use the spacing scale");
