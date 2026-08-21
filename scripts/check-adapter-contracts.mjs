import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapterSources = [
  {
    label: "WebConsoleAdapter",
    path: path.join(projectRoot, "apps/web/src/lib/console-adapter.ts"),
    classPattern: /class\s+WebConsoleAdapter\s+implements\s+ConsoleAdapter/,
    capability: "WEB_CAPABILITIES"
  },
  {
    label: "DesktopConsoleAdapter",
    path: path.join(projectRoot, "apps/desktop/src/renderer/services/consoleAdapter.ts"),
    classPattern: /class\s+DesktopConsoleAdapter\s+implements\s+ConsoleAdapter/,
    capability: "DESKTOP_CAPABILITIES"
  }
];
const requiredMethods = [
  "getSnapshot",
  "refresh",
  "subscribe",
  "login",
  "logout",
  "disconnectAgent",
  "saveHubConnection",
  "deleteInstance",
  "reorderInstances",
  "saveFanNote",
  "getWidgetLayout",
  "saveWidgetLayout",
  "openExternal"
];

let failures = 0;
for (const adapter of adapterSources) {
  if (!fs.existsSync(adapter.path)) {
    failures++;
    console.error(`❌ Adapter contract: missing ${adapter.label} source.`);
    continue;
  }
  const source = fs.readFileSync(adapter.path, "utf8");
  if (!adapter.classPattern.test(source)) {
    failures++;
    console.error(`❌ Adapter contract: ${adapter.label} must implement ConsoleAdapter.`);
  }
  if (!new RegExp(`\\b${adapter.capability}\\b`).test(source)) {
    failures++;
    console.error(`❌ Adapter contract: ${adapter.label} must declare ${adapter.capability}.`);
  }
  for (const method of requiredMethods) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(source)) {
      failures++;
      console.error(`❌ Adapter contract: ${adapter.label} is missing ${method}().`);
    }
  }
}

if (failures > 0) {
  console.error(`[check:adapter-contracts] FAILED: ${failures} issue(s) detected.`);
  process.exit(1);
}

console.log("[check:adapter-contracts] SUCCESS: Web and Electron adapters expose the shared contract.");
