import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const appRoot = path.join(projectRoot, "apps/web/src/app");
const componentRoot = path.join(projectRoot, "apps/web/src/components");
const legacyComponentRoot = path.join(componentRoot, "legacy");
const homeRoute = path.join(appRoot, "page.tsx");
const deviceRoute = path.join(appRoot, "devices/[deviceId]/page.tsx");
const archivedLegacyFiles = [
  "chart-card.tsx",
  "dashboard.tsx",
  "device-sidebar.tsx",
  "home-client.tsx",
  "home-overview.tsx",
  "metric-config-modal.tsx",
  "monitor.module.css",
  "saas-shell.tsx",
  "traffic-calendar.tsx",
  "update-notice.tsx"
];

const legacyRoutePatterns = [
  { pattern: /HomeClient/, reason: "legacy HomeClient route" },
  { pattern: /SaasShell/, reason: "legacy SaaS shell route" },
  { pattern: /DeviceSidebar/, reason: "legacy device sidebar route" },
  { pattern: /HomeOverview/, reason: "legacy home overview route" },
  { pattern: /MetricConfigModal/, reason: "legacy metric configuration route" },
  { pattern: /TrafficCalendar/, reason: "legacy traffic calendar route" },
  { pattern: /from\s+["'][^"']*components\/(?:dashboard|home-client|saas-shell|device-sidebar)[^"']*["']/, reason: "legacy Web component import" }
];

let violationCount = 0;

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    violationCount++;
    console.error(`❌ Web UI boundary: missing ${path.relative(projectRoot, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

const homeSource = readRequired(homeRoute);
const deviceSource = readRequired(deviceRoute);

if (!/UnifiedConsole/.test(homeSource)) {
  violationCount++;
  console.error("❌ Web UI boundary: the home route must use UnifiedConsole.");
}

if (!/UnifiedConsole/.test(deviceSource)) {
  violationCount++;
  console.error("❌ Web UI boundary: the device route must use UnifiedConsole.");
}

function scanRouteDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanRouteDirectory(fullPath);
      continue;
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
    const source = fs.readFileSync(fullPath, "utf8");
    for (const { pattern, reason } of legacyRoutePatterns) {
      if (!pattern.test(source)) continue;
      violationCount++;
      console.error(`❌ Web UI boundary in [${path.relative(projectRoot, fullPath)}]: ${reason}`);
    }
  }
}

scanRouteDirectory(appRoot);

const unifiedConsolePath = path.join(projectRoot, "apps/web/src/components/unified-console.tsx");
const unifiedConsoleSource = readRequired(unifiedConsolePath);
if (!/from\s+["']@dsc\/console-ui["']/.test(unifiedConsoleSource)) {
  violationCount++;
  console.error("❌ Web UI boundary: UnifiedConsole must render the shared @dsc/console-ui package.");
}

if (!fs.existsSync(legacyComponentRoot)) {
  violationCount++;
  console.error("❌ Web UI boundary: legacy Web component archive is missing.");
} else {
  for (const fileName of archivedLegacyFiles) {
    const archivedPath = path.join(legacyComponentRoot, fileName);
    if (!fs.existsSync(archivedPath)) {
      violationCount++;
      console.error(`❌ Web UI boundary: archived legacy component is missing ${path.relative(projectRoot, archivedPath)}.`);
    }
    const activePath = path.join(componentRoot, fileName);
    if (fs.existsSync(activePath)) {
      violationCount++;
      console.error(`❌ Web UI boundary: legacy component remains in the active component root ${path.relative(projectRoot, activePath)}.`);
    }
  }
}

console.log(`[check:web-ui-boundary] Scanned active Web routes under ${path.relative(projectRoot, appRoot)} and archived legacy components.`);

if (violationCount > 0) {
  console.error(`[check:web-ui-boundary] FAILED: ${violationCount} boundary violation(s) detected.`);
  process.exit(1);
}

console.log("[check:web-ui-boundary] SUCCESS: Web routes use the shared console UI entry.");
