import type { DesktopAgentBackendState } from "@dsc/shared";
import { formatBytes, formatDate, formatPreciseDateTime } from "./formatters";
import { formatWorkspaceError } from "./context/WorkspaceTypes";

/**
 * Presentation model for the desktop Agent's diagnostic state.
 *
 * `DesktopAgentBackendState` carries far more than a settings page can show in
 * one screen's worth of "运行方式 / 连接状态 / 上传间隔". The fields that answer
 * "why did it stop reporting" — restart count, last exit, backlog age, file
 * paths — used to be collected by the main process and then never read by any
 * page, so the only visible failure signal was a single error string.
 *
 * Everything here reads the *redacted* snapshot: `redactBackendState` in the
 * Electron main process already strips the Agent secret, and so does
 * `DesktopCacheStore.sanitizeCachedSnapshot` for offline snapshots. No function
 * in this module may receive or return a credential.
 */

export interface DiagnosticFact {
  label: string;
  value: string;
}

/** One line of the last recorded collector issue. */
export interface AgentIssueSummary {
  label: string;
  detail: string;
  at: string | null;
  recoveredAt: string | null;
}

const NOT_RECORDED = "未记录";

function fact(label: string, value: string | null | undefined): DiagnosticFact {
  const text = (value ?? "").trim();
  return { label, value: text || NOT_RECORDED };
}

/**
 * "代理托管" is a real distinction, not a missing value: a machine-scope
 * service owns the collector process, so the desktop shell has no child start
 * time to report. Saying "未记录" there would send the reader hunting for a
 * field that cannot exist in that mode.
 */
function childStartValue(backend: DesktopAgentBackendState): string {
  if (backend.childStartedAt) return formatPreciseDateTime(backend.childStartedAt);
  return backend.agentMode === "child" ? "" : "由系统服务托管";
}

export function describeAgentRuntime(backend: DesktopAgentBackendState): DiagnosticFact[] {
  const exitAt = backend.lastExitAt ? formatPreciseDateTime(backend.lastExitAt) : "";
  const exitCode = backend.lastExitCode == null ? "" : `退出码 ${backend.lastExitCode}`;
  return [
    fact("Agent 启动于", backend.backendStartedAt ? formatPreciseDateTime(backend.backendStartedAt) : ""),
    fact("采集进程启动于", childStartValue(backend)),
    fact("自动重启", backend.restartCount > 0 ? `已重启 ${backend.restartCount} 次` : "尚未重启"),
    fact("最近退出", [exitAt, exitCode].filter(Boolean).join(" · ")),
    fact("最近重启", backend.lastRestartAt ? formatPreciseDateTime(backend.lastRestartAt) : ""),
    fact("自动重启挂起", backend.autoRestartPending ? "是，正在等待采集器恢复" : "否"),
    fact("最近硬件检测", backend.lastDetectAt ? formatPreciseDateTime(backend.lastDetectAt) : "")
  ];
}

export function describeAgentUpload(backend: DesktopAgentBackendState): DiagnosticFact[] {
  const pendingCount = backend.pendingSampleCount ?? 0;
  const oldest = pendingCount > 0 && backend.oldestPendingAt
    ? `${formatPreciseDateTime(backend.oldestPendingAt)}（积压 ${pendingCount} 条 · ${formatBytes(backend.pendingBytes)}）`
    : "";
  return [
    fact("最近成功上传", backend.lastUploadAt ? formatPreciseDateTime(backend.lastUploadAt) : ""),
    fact("最近同步到中枢", backend.lastCloudSyncAt ? formatPreciseDateTime(backend.lastCloudSyncAt) : ""),
    fact("云配置同步", backend.cloudConfigPending ? "有改动待上传" : "没有待同步的改动"),
    fact("最老待上传样本", pendingCount > 0 ? oldest : "无积压")
  ];
}

/** Files a support conversation will ask about, with their existence state. */
export function describeAgentStorage(backend: DesktopAgentBackendState): DiagnosticFact[] {
  const pathFact = (label: string, path: string | undefined, exists: boolean) =>
    fact(label, path ? `${path}${exists ? "" : "（未找到）"}` : "");
  return [
    pathFact("配置文件", backend.configPath, backend.configFileExists),
    pathFact("同步状态", backend.syncStatePath, backend.syncStateFileExists),
    pathFact("待上传队列", backend.pendingStatePath, backend.pendingStateFileExists),
    pathFact("采集日志", backend.diagnosticsPath, backend.diagnosticsFileExists)
  ];
}

export function selectAgentIssue(backend: DesktopAgentBackendState): AgentIssueSummary | null {
  const detail = backend.lastIssueDetail?.trim() ?? "";
  const category = backend.lastIssueCategory?.trim() ?? "";
  if (!detail && !category) return null;
  return {
    label: category || "未分类问题",
    detail: detail || "中枢与 Agent 都没有记录更多细节。",
    at: backend.lastIssueAt ?? null,
    recoveredAt: backend.lastIssueRecoveredAt ?? null
  };
}

/** The resolved upload failure, in the same words the status card uses. */
export function describeAgentUploadError(backend: DesktopAgentBackendState): string | null {
  if (!backend.lastUploadError?.trim()) return null;
  return formatWorkspaceError(new Error(backend.lastUploadError), "本机 Agent 上报失败，请检查连接和配置");
}

export function describeAgentCloudSyncError(backend: DesktopAgentBackendState): string | null {
  if (!backend.lastCloudSyncError?.trim()) return null;
  return formatWorkspaceError(new Error(backend.lastCloudSyncError), "云配置同步失败，请检查中枢连接与访问密钥");
}

/** How many samples are waiting to reach the hub. */
export function pendingSampleSummary(backend: DesktopAgentBackendState): string {
  const count = backend.pendingSampleCount ?? 0;
  if (count <= 0) return "0 条";
  return `${count} 条 · ${formatBytes(backend.pendingBytes)}`;
}

const CHILD_LOG_TAIL = 2_000;

/**
 * Build the support artifact.
 *
 * Plain text on purpose: it is copied to a clipboard and pasted into a chat, so
 * it must survive without markdown rendering, and it must be readable when the
 * person on the other end has no access to this machine. The credential line is
 * not decoration — it tells the reader what was deliberately withheld, which is
 * the question a redacted export always raises.
 */
export function buildAgentDiagnosticsReport(
  backend: DesktopAgentBackendState,
  context: { appVersion: string; generatedAt: string }
): string {
  const section = (title: string, facts: DiagnosticFact[]) =>
    `${title}\n${facts.map((item) => `- ${item.label}：${item.value}`).join("\n")}`;
  const parts: string[] = [
    "观澜本机 Agent 诊断",
    `导出时间：${formatPreciseDateTime(context.generatedAt)}`,
    `应用版本：${context.appVersion}`,
    `运行方式：${describeAgentMode(backend.agentMode)}`
  ];

  parts.push(section("运行历史", describeAgentRuntime(backend)));
  parts.push(section("上传与积压", describeAgentUpload(backend)));

  const uploadError = describeAgentUploadError(backend);
  const cloudError = describeAgentCloudSyncError(backend);
  const issue = selectAgentIssue(backend);
  const problemFacts: DiagnosticFact[] = [
    fact("最适连接状态", backend.connectionStatus),
    fact("记录到的问题次数", backend.lastIssueCount > 0 ? `${backend.lastIssueCount} 次` : "无")
  ];
  if (issue) problemFacts.push(fact(`最近问题（${issue.label}）`, [issue.at ? formatDate(issue.at) : "", issue.detail].filter(Boolean).join(" · ")));
  if (issue?.recoveredAt) problemFacts.push(fact("问题恢复于", formatDate(issue.recoveredAt)));
  if (uploadError) problemFacts.push(fact("最近上传问题", uploadError));
  if (cloudError) problemFacts.push(fact("最近云同步问题", cloudError));
  parts.push(section("问题记录", problemFacts));

  parts.push(section("本机文件", describeAgentStorage(backend)));

  const childLog = backend.lastChildLog?.trim();
  if (childLog) {
    parts.push(`采集进程日志（末 ${CHILD_LOG_TAIL} 字）\n${childLog.slice(-CHILD_LOG_TAIL)}`);
  }

  parts.push("凭据说明\n- 访问密钥与上报凭据不会出现在本报告中；桌面主进程在生成快照时就已将其移除。");
  return `${parts.join("\n\n")}\n`;
}

function describeAgentMode(mode: DesktopAgentBackendState["agentMode"]): string {
  if (mode === "service") return "系统服务（可管理）";
  if (mode === "service-readonly") return "系统服务（只读）";
  return "桌面端托管进程";
}
