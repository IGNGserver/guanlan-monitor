import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.resolve(__dirname, "../apps/desktop/src/renderer-guanlan");
const rendererEntry = path.resolve(__dirname, "../apps/desktop/src/renderer/App.tsx");
const workspaceDir = path.resolve(targetDir, "workspace");

console.log(`[check:desktop-ui-boundaries] Scanning isolated renderer at: ${targetDir}`);

if (!fs.existsSync(targetDir)) {
  console.error(`[check:desktop-ui-boundaries] Error: Target directory does not exist: ${targetDir}`);
  process.exit(1);
}

if (!fs.existsSync(workspaceDir)) {
  console.error(`[check:desktop-ui-boundaries] Error: Workspace directory does not exist: ${workspaceDir}`);
  process.exit(1);
}

const forbiddenPatterns = [
  // Web / Hub imports or package dependencies
  { pattern: /from\s+["'].*apps\/web.*["']/i, reason: "Import from apps/web" },
  { pattern: /from\s+["'].*@dsc\/web.*["']/i, reason: "Import of @dsc/web" },
  { pattern: /from\s+["'].*\.\.\/\.\.\/web.*["']/i, reason: "Relative import to web app" },

  // Old Hub component names used in code
  { pattern: /<\s*SaaSShell\b/, reason: "Reference to old SaaSShell component" },
  { pattern: /<\s*OverviewCards\b/, reason: "Reference to old OverviewCards component" },
  { pattern: /<\s*TrafficCalendarView\b/, reason: "Reference to old TrafficCalendarView component" },
  { pattern: /<\s*InstanceDetailView\b/, reason: "Reference to old InstanceDetailView component" },
  { pattern: /<\s*LocalConfigView\b/, reason: "Reference to old LocalConfigView component" },
  { pattern: /<\s*StatusBanner\b/, reason: "Reference to old StatusBanner component" },

  // Old dashboard CSS token names (the workspace uses --workspace-* semantic tokens)
  { pattern: /--bg-dark\b/, reason: "Reference to old CSS token --bg-dark" },
  { pattern: /--accent-cyan\b/, reason: "Reference to old CSS token --accent-cyan" },
  { pattern: /--accent-purple\b/, reason: "Reference to old CSS token --accent-purple" },
  { pattern: /--bg-card\b/, reason: "Reference to old CSS token --bg-card" },
  { pattern: /--bg-sidebar\b/, reason: "Reference to old CSS token --bg-sidebar" }
];

const activeRendererPatterns = [
  { pattern: /LegacyApp|isLegacyModeRequested|dsc_legacy_ui|legacy-active/, reason: "Legacy renderer switch remains reachable" },
  { pattern: /ConsoleProvider|useConsole|OverviewCards|TrafficCalendarView|InstanceDetailView|LocalConfigView/, reason: "Old renderer surface remains reachable" },
  // Emoji belong in content, not in the desktop control surface. Icons are inline SVG paths.
  { pattern: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, reason: "Emoji found in active desktop UI" }
];

let scannedCount = 0;
let violationCount = 0;

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
}

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === workspaceDir) continue;
      scanDirectory(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|css|js|mjs|json)$/.test(entry.name)) {
      scannedCount++;
      const rawContent = fs.readFileSync(fullPath, "utf-8");
      const codeOnly = stripComments(rawContent);
      const relativePath = path.relative(targetDir, fullPath);

      for (const { pattern, reason } of forbiddenPatterns) {
        if (pattern.test(codeOnly)) {
          violationCount++;
          console.error(`❌ Boundary Violation in [${relativePath}]: ${reason}`);
        }
      }
    }
  }
}

scanDirectory(targetDir);

if (fs.existsSync(rendererEntry)) {
  const rawContent = fs.readFileSync(rendererEntry, "utf-8");
  const codeOnly = stripComments(rawContent);
  for (const { pattern, reason } of activeRendererPatterns) {
    if (pattern.test(codeOnly)) {
      violationCount++;
      console.error(`❌ Boundary Violation in [renderer/App.tsx]: ${reason}`);
    }
  }
  scannedCount++;
} else {
  violationCount++;
  console.error("❌ Boundary Violation: renderer/App.tsx is missing");
}

function scanActiveWorkspace(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanActiveWorkspace(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|css|js|mjs|json)$/.test(entry.name)) {
      scannedCount++;
      const codeOnly = stripComments(fs.readFileSync(fullPath, "utf-8"));
      for (const { pattern, reason } of activeRendererPatterns) {
        if (pattern.test(codeOnly)) {
          violationCount++;
          console.error(`❌ Boundary Violation in [${path.relative(targetDir, fullPath)}]: ${reason}`);
        }
      }
    }
  }
}

scanActiveWorkspace(workspaceDir);

console.log(`[check:desktop-ui-boundaries] Scanned ${scannedCount} files.`);

if (violationCount > 0) {
  console.error(`[check:desktop-ui-boundaries] FAILED: ${violationCount} boundary violation(s) detected.`);
  process.exit(1);
} else {
  console.log(`[check:desktop-ui-boundaries] SUCCESS: Zero boundary violations detected.`);
  process.exit(0);
}
