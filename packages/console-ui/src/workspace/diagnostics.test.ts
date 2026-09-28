import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopAgentBackendState } from "@dsc/shared";
import {
  buildAgentDiagnosticsReport,
  describeAgentCloudSyncError,
  describeAgentRuntime,
  describeAgentStorage,
  describeAgentUpload,
  describeAgentUploadError,
  pendingSampleSummary,
  selectAgentIssue
} from "./diagnostics.ts";
import { platformShortcutRows } from "./shortcuts.ts";

/**
 * The desktop Agent's diagnostic surface is the one thing the browser console
 * cannot have, so nothing else in the web visual matrix would notice if a field
 * silently stopped reaching it.
 *
 * These are behavioral assertions, not text matching: the fixture fills every
 * diagnostic field `DesktopAgentBackendState` exposes, and the export must
 * carry each rendered value. A field that is added to the shared type and
 * forgotten here fails the "every collected fact reaches the export" test.
 */

const fixtureBackend = (overrides: Partial<DesktopAgentBackendState> = {}): DesktopAgentBackendState => ({
  running: true,
  backendStartedAt: "2026-09-27T01:00:00.000Z",
  frontendParentPid: 4242,
  childStartedAt: "2026-09-27T01:00:05.000Z",
  connectionStatus: "已连接",
  lastChildLog: "[backend] collector started",
  lastUploadAt: "2026-09-27T02:00:00.000Z",
  lastCloudSyncAt: "2026-09-27T01:30:00.000Z",
  cloudConfigPending: true,
  lastDetectAt: "2026-09-27T01:20:00.000Z",
  lastExitAt: "2026-09-27T00:59:00.000Z",
  lastRestartAt: "2026-09-27T01:00:05.000Z",
  restartCount: 3,
  lastExitCode: 137,
  autoRestartPending: true,
  effectiveUploadIntervalSeconds: 30,
  lastIssueCategory: "upload",
  lastIssueDetail: "中枢连接被拒绝",
  lastIssueAt: "2026-09-27T02:05:00.000Z",
  lastIssueCount: 2,
  lastIssueRecoveredAt: "2026-09-27T02:06:00.000Z",
  configPath: "/home/user/.config/guanlan/agent-ui.config.json",
  configFileExists: true,
  syncStatePath: "/home/user/.config/guanlan/agent-ui.sync-state.json",
  syncStateFileExists: true,
  diagnosticsPath: "/home/user/.config/guanlan/agent-ui.backend.log",
  diagnosticsFileExists: false,
  pendingStatePath: "/home/user/.config/guanlan/agent-ui.pending.jsonl",
  pendingStateFileExists: true,
  pendingSampleCount: 120,
  pendingBytes: 48_000,
  oldestPendingAt: "2026-09-27T01:45:00.000Z",
  lastUploadError: "hub_503:service unavailable",
  config: {
    configVersion: 1,
    connection: { serverUrl: "https://hub.example.com", deviceId: "workstation-01", hostname: " workstation ", secretConfigured: true },
    sampling: { normalIntervalSeconds: 30, slowIntervalSeconds: 60 },
    enabledMetrics: [],
    enabledDeviceIds: {},
    instanceMetricConfig: {},
    probeSelections: [],
    cloudSyncEnabled: true,
    dataRecordingEnabled: true,
    autoRestartCollector: true,
    autoStartCollector: true
  },
  supportedProbePlans: [],
  detectedTargets: [],
  temperatureSources: [],
  temperatureSensorBackends: [],
  agentMode: "child",
  ...overrides
});

test("runtime history surfaces every collected lifecycle fact", () => {
  const facts = describeAgentRuntime(fixtureBackend());
  const rendered = facts.map((item) => `${item.value}`).join("\n");
  const labels = facts.map((item) => item.label);

  assert.deepStrictEqual(labels, ["Agent 启动于", "采集进程启动于", "自动重启", "最近退出", "最近重启", "自动重启挂起", "最近硬件检测"]);
  assert.match(rendered, /2026\/09\/27/, "start times must be formatted, not printed as raw ISO");
  assert.match(rendered, /已重启 3 次/);
  assert.match(rendered, /退出码 137/);
  assert.match(rendered, /等待采集器恢复/);
  for (const fact of facts) {
    assert.doesNotMatch(fact.value, /undefined|NaN|\[object/, `${fact.label} leaked a placeholder`);
  }
});

test("a service-managed Agent explains the missing child start time instead of claiming none", () => {
  const managed = describeAgentRuntime(fixtureBackend({ childStartedAt: undefined, agentMode: "service" }));
  const childStart = managed.find((item) => item.label === "采集进程启动于");
  assert.equal(childStart?.value, "由系统服务托管", "a machine-scope service owns the collector, so there is no child start time to show");
  const resumed = describeAgentRuntime(fixtureBackend({ childStartedAt: undefined, agentMode: "child" }));
  assert.equal(resumed.find((item) => item.label === "采集进程启动于")?.value, "未记录", "a missing child start on the portable path is a real gap");
});

test("upload progress carries backlog size and the age of the oldest queued sample", () => {
  const facts = describeAgentUpload(fixtureBackend());
  const rendered = facts.map((item) => `${item.label}：${item.value}`).join("\n");
  assert.match(rendered, /最近成功上传/);
  assert.match(rendered, /最近同步到中枢/);
  assert.match(rendered, /有改动待上传/);
  assert.match(rendered, /积压 120 条/);
  assert.match(rendered, /46\.9 KB/);
});

test("an empty queue says so rather than printing a bare zero", () => {
  const facts = describeAgentUpload(fixtureBackend({ pendingSampleCount: 0, pendingBytes: 0, oldestPendingAt: undefined, cloudConfigPending: false }));
  assert.equal(facts.find((item) => item.label === "最老待上传样本")?.value, "无积压");
  assert.equal(facts.find((item) => item.label === "云配置同步")?.value, "没有待同步的改动");
  assert.equal(pendingSampleSummary(fixtureBackend({ pendingSampleCount: 0, pendingBytes: 0 })), "0 条");
  assert.equal(pendingSampleSummary(fixtureBackend()), "120 条 · 46.9 KB");
});

test("storage facts name every file and flag the missing ones", () => {
  const storage = describeAgentStorage(fixtureBackend());
  assert.deepStrictEqual(storage.map((item) => item.label), ["配置文件", "同步状态", "待上传队列", "采集日志"]);
  assert.match(storage[0].value, /agent-ui\.config\.json$/);
  assert.match(storage[3].value, /（未找到）$/, "a missing diagnostics log must be marked, not silently blank");
  assert.doesNotMatch(storage[3].value, /（未找到）（未找到）/);
});

test("upload and cloud-sync failures are translated, not echoed as transport codes", () => {
  const backend = fixtureBackend();
  assert.match(describeAgentUploadError(backend) ?? "", /服务暂时不可用/);
  assert.doesNotMatch(describeAgentUploadError(backend) ?? "", /hub_503/);
  const cloud = describeAgentCloudSyncError(fixtureBackend({ lastCloudSyncError: "unauthorized" }));
  assert.match(cloud ?? "", /重新认证/);
  assert.equal(describeAgentUploadError(fixtureBackend({ lastUploadError: undefined })), null);
  assert.equal(describeAgentCloudSyncError(fixtureBackend({ lastCloudSyncError: undefined })), null);
});

test("a recorded issue is summarised with its window, and an absent one is null", () => {
  const issue = selectAgentIssue(fixtureBackend());
  assert.equal(issue?.label, "upload");
  assert.equal(issue?.detail, "中枢连接被拒绝");
  assert.equal(issue?.at, "2026-09-27T02:05:00.000Z");
  assert.equal(issue?.recoveredAt, "2026-09-27T02:06:00.000Z");
  assert.equal(selectAgentIssue(fixtureBackend({ lastIssueCategory: undefined, lastIssueDetail: undefined })), null);
});

test("the support export carries every rendered fact and states what was withheld", () => {
  const report = buildAgentDiagnosticsReport(fixtureBackend(), {
    appVersion: "3.0.124",
    generatedAt: "2026-09-27T03:00:00.000Z"
  });

  for (const heading of ["观澜本机 Agent 诊断", "运行历史", "上传与积压", "问题记录", "本机文件", "凭据说明"]) {
    assert.ok(report.includes(heading), `the export is missing the "${heading}" section`);
  }
  for (const value of [
    "3.0.124",
    "已重启 3 次",
    "退出码 137",
    "积压 120 条",
    "agent-ui.config.json",
    "agent-ui.backend.log",
    "中枢连接被拒绝",
    "服务暂时不可用",
    "[backend] collector started"
  ]) {
    assert.ok(report.includes(value), `the export dropped "${value}"`);
  }
  assert.match(report, /访问密钥与上报凭据不会出现在本报告中/);
  // The snapshot contract has no secret field at all; the export must never
  // invent one from the connection block.
  assert.doesNotMatch(report, /secretConfigured|"secret"|accessKey/i);
  assert.ok(report.endsWith("\n"), "a copied artifact should end on a newline");
});

test("the log tail is bounded so one runaway child cannot flood the report", () => {
  const flood = "x".repeat(5_000);
  const report = buildAgentDiagnosticsReport(fixtureBackend({ lastChildLog: flood }), {
    appVersion: "3.0.124",
    generatedAt: "2026-09-27T03:00:00.000Z"
  });
  const logSection = report.split("采集进程日志")[1] ?? "";
  assert.ok(logSection.length <= 2_000 + 64, `log tail should be capped at 2000 chars, got ${logSection.length}`);
  assert.ok(!report.includes(flood), "the full unbounded log must not reach the export");
});

test("an Agent that has never reported exports without placeholder noise", () => {
  const report = buildAgentDiagnosticsReport(fixtureBackend({
    childStartedAt: undefined,
    lastUploadAt: undefined,
    lastCloudSyncAt: undefined,
    lastDetectAt: undefined,
    lastExitAt: undefined,
    lastExitCode: undefined,
    lastRestartAt: undefined,
    restartCount: 0,
    lastIssueCategory: undefined,
    lastIssueDetail: undefined,
    lastUploadError: undefined,
    pendingSampleCount: 0,
    pendingBytes: 0,
    oldestPendingAt: undefined,
    agentMode: "service-readonly"
  }), { appVersion: "3.0.124", generatedAt: "2026-09-27T03:00:00.000Z" });
  assert.doesNotMatch(report, /undefined|NaN|\[object Object\]/);
  assert.match(report, /系统服务（只读）/);
  assert.match(report, /尚未重启/);
});

test("the shortcut reference names the keys the current platform actually has", () => {
  const mac = platformShortcutRows("mac", "Ctrl+R", true);
  const win = platformShortcutRows("windows", "Ctrl+R", true);
  const web = platformShortcutRows("linux", "F5", false);

  assert.ok(win.every((row) => !row.keys.includes("⌘")), "Windows must not be shown the Command key");
  assert.ok(mac.some((row) => row.keys.includes("⌘")), "macOS must be shown the Command key");
  for (const rows of [mac, win]) {
    assert.ok(!rows.some((row) => row.keys === "F5" || row.keys.startsWith("F5")), "the native client has no browser reload key");
  }
  assert.ok(web.some((row) => row.keys.startsWith("F5")), "the browser client's reload key is F5");
  assert.ok(web.every((row) => !row.description.includes("托盘")), "the browser has no tray to hide into");
  assert.ok(mac.some((row) => row.description.includes("托盘")), "the desktop client owns the hide-to-tray shortcut");
  for (const rows of [mac, win, web]) {
    assert.ok(rows.every((row) => row.keys.trim().length > 0 && row.description.trim().length > 0));
  }
});
