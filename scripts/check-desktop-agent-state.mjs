import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard against a diagnostic field being collected and then forgotten.
 *
 * `DesktopAgentBackendState` is filled by the Electron main process on every
 * snapshot, but for a long time the settings page rendered only five of its
 * thirty-odd fields: restart counts, last exit, backlog age, log paths and the
 * issue window were invisible. Nothing in the web visual matrix could notice,
 * because the browser console does not even render that page.
 *
 * This check is deliberately about *reachability from the UI*, not about the
 * presentation code: it follows the settings page's module graph and asserts
 * that each named field is read somewhere the page can render. Adding a field to
 * the shared type without wiring it into the diagnostics surface fails here,
 * which is the whole point.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingsPage = path.join(projectRoot, "packages/console-ui/src/workspace/pages/SettingsPage.tsx");

/** Fields the desktop Agent status must be able to show the user. */
const requiredFields = [
  "backendStartedAt",
  "childStartedAt",
  "restartCount",
  "lastRestartAt",
  "lastExitAt",
  "lastExitCode",
  "autoRestartPending",
  "lastUploadAt",
  "lastCloudSyncAt",
  "lastCloudSyncError",
  "cloudConfigPending",
  "oldestPendingAt",
  "pendingSampleCount",
  "pendingBytes",
  "lastIssueCategory",
  "lastIssueDetail",
  "lastIssueAt",
  "lastIssueRecoveredAt",
  "lastIssueCount",
  "lastUploadError",
  "configPath",
  "configFileExists",
  "syncStatePath",
  "syncStateFileExists",
  "diagnosticsPath",
  "diagnosticsFileExists",
  "pendingStatePath",
  "pendingStateFileExists",
  "lastChildLog"
];

let failures = 0;
const fail = (message) => {
  failures++;
  console.error(`❌ Desktop agent state: ${message}`);
};

/** Resolve a relative import to a file inside the console-ui source tree. */
function resolveSource(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Follow the page's real import graph (one level is not enough here: the status
 * fields live in `workspace/diagnostics.ts`, which the page imports directly,
 * but the guard should keep working if that moves).
 */
function collectReachableSources(entry, visited = new Set()) {
  const sources = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file) || !fs.existsSync(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    sources.push({ file, source });
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      if (match[1].startsWith("@dsc/")) continue;
      const resolved = resolveSource(file, match[1]);
      if (resolved && resolved.includes(`${path.sep}console-ui${path.sep}src${path.sep}`)) queue.push(resolved);
    }
  }
  return sources;
}

if (!fs.existsSync(settingsPage)) {
  fail("the Agent settings page is missing");
} else {
  const sources = collectReachableSources(settingsPage);
  const combined = sources.map((entry) => entry.source).join("\n");
  const missing = requiredFields.filter((field) => !new RegExp(`\\.${field}\\b`).test(combined));
  for (const field of missing) {
    fail(`${field} is collected by the desktop Agent but not read by any module the settings page can render`);
  }
}

console.log(`[check:desktop-agent-state] Scanned the settings page and its local imports.`);

if (failures > 0) {
  console.error(`[check:desktop-agent-state] FAILED: ${failures} issue(s) detected.`);
  process.exit(1);
}
console.log(`[check:desktop-agent-state] SUCCESS: ${requiredFields.length} Agent state fields are wired into the UI.`);
process.exit(0);
