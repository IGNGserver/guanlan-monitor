import { createServer } from "node:net";
import { access, chmod, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { DesktopAgentControlAction, DesktopAgentMode } from "@dsc/shared";
import { appendDesktopDiagnostic } from "./diagnostics.js";
import type { AgentBackendConfig, RawAgentBackendState } from "./types.js";

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

/**
 * Raised when the desktop shell is attached to the machine-scope service but
 * this user may not perform privileged operations on it.
 */
export class BackendPermissionError extends Error {
  command: string;

  constructor(message: string, command: string) {
    super(message);
    this.name = "BackendPermissionError";
    this.command = command;
  }
}

interface AgentManagerOptions {
  userDataPath: string;
  resourcesPath: string;
  backendBinary?: string;
}

/** Loopback endpoint of the machine-scope service. */
export const SERVICE_LISTEN_ADDRESS = "127.0.0.1:17891";

const SERVICE_PROBE_TIMEOUT_MS = 2_500;
const SERVICE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Machine-scope configuration directory. Mirrors agents/internal/agentconfig:
 * `%ProgramData%\Guanlan` on Windows, `/etc/guanlan` on Linux, overridable with
 * GUANLAN_CONFIG_ROOT.
 */
export function resolveMachineConfigDir(): string {
  const override = process.env.GUANLAN_CONFIG_ROOT?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const programData = process.env.ProgramData?.trim() || "C:\\ProgramData";
    return path.join(programData, "Guanlan");
  }
  return "/etc/guanlan";
}

export function machineTokenPath(configDir = resolveMachineConfigDir()): string {
  return path.join(configDir, "agent-ui.local-token");
}

/** Raw shape of the redacted GET /api/status document. */
interface ServiceStatusPayload {
  running: boolean;
  serviceScope: boolean;
  collectorRunning: boolean;
  connectionStatus: string;
  configured: boolean;
  deviceId?: string;
  hostname?: string;
  hubServerUrl?: string;
  autoStartCollector: boolean;
  dataRecordingEnabled: boolean;
  cloudSyncEnabled: boolean;
  lastUploadAt?: string;
  lastUploadError?: string;
  pendingSamples: number;
  pendingBytes: number;
  oldestPendingAt?: string;
  restartCount: number;
  version: string;
  channel: string;
  configDir?: string;
  configPath?: string;
  syncStatePath?: string;
  diagnosticsPath?: string;
  pendingStatePath?: string;
  backendStartedAt?: string;
  childStartedAt?: string;
  effectiveUploadIntervalSeconds?: number;
}

export class AgentManager {
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private localToken = randomBytes(32).toString("hex");
  private lastOutput = "";
  /** Set when baseUrl points at the machine-scope service instead of our child. */
  private attached = false;
  private attachedReadOnly = false;
  private machineConfigDir = resolveMachineConfigDir();

  constructor(private readonly options: AgentManagerOptions) {}

  get localEndpoint(): string | null {
    return this.baseUrl;
  }

  /** How the desktop shell currently reaches the agent data plane. */
  get mode(): DesktopAgentMode {
    if (!this.attached) return "child";
    return this.attachedReadOnly ? "service-readonly" : "service";
  }

  get isAttachedToService(): boolean {
    return this.attached;
  }

  /**
   * Prefer the machine-scope service and only fall back to owning a private
   * backend process when no service is installed or running.
   */
  async start(): Promise<RawAgentBackendState> {
    await this.stopChildIfRunning();
    const attachedState = await this.attach();
    if (attachedState) return attachedState;
    return this.spawn();
  }

  /**
   * Probe the machine-scope service.
   *
   * The redacted /api/status document needs no token, so any local user can see
   * whether the machine is reporting. Full state and configuration writes need
   * the control token file, which is restricted to SYSTEM/Administrators on
   * Windows and root/guanlan on Linux; without it the shell degrades to
   * read-only instead of silently spawning a second collector.
   */
  async attach(): Promise<RawAgentBackendState | null> {
    const configDir = resolveMachineConfigDir();
    this.machineConfigDir = configDir;
    const status = await this.fetchServiceStatus();
    if (!status) return null;

    const token = await this.readServiceToken(configDir);
    if (token) {
      try {
        const state = await this.requestService<RawAgentBackendState>("/api/state", token);
        this.baseUrl = `http://${SERVICE_LISTEN_ADDRESS}`;
        this.localToken = token;
        this.attached = true;
        this.attachedReadOnly = false;
        appendDesktopDiagnostic("agent-attached-service", { configDir });
        return { ...state, agentMode: "service" };
      } catch (error) {
        appendDesktopDiagnostic("agent-attach-state-failed", { error });
      }
    }

    this.baseUrl = `http://${SERVICE_LISTEN_ADDRESS}`;
    this.localToken = "";
    this.attached = true;
    this.attachedReadOnly = true;
    appendDesktopDiagnostic("agent-attached-service-readonly", { configDir });
    return synthesizeStateFromStatus(status, configDir);
  }

  private async fetchServiceStatus(): Promise<ServiceStatusPayload | null> {
    try {
      const response = await fetch(`http://${SERVICE_LISTEN_ADDRESS}/api/status`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(SERVICE_PROBE_TIMEOUT_MS)
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ServiceStatusPayload;
      if (!payload || typeof payload.running !== "boolean") return null;
      return payload;
    } catch {
      // No service is listening: this is the normal portable/development case.
      return null;
    }
  }

  private async readServiceToken(configDir: string): Promise<string | null> {
    try {
      const raw = await readFile(machineTokenPath(configDir), "utf8");
      const token = raw.trim();
      return token.length >= 16 ? token : null;
    } catch {
      return null;
    }
  }

  private async requestService<T>(endpoint: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`http://${SERVICE_LISTEN_ADDRESS}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-DSC-Local-Token": token,
        ...Object.fromEntries(new Headers(init.headers).entries())
      },
      signal: init.signal ?? AbortSignal.timeout(SERVICE_REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      const detail = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
      throw new Error(`agent_backend_${response.status}:${detail}`);
    }
    return payload as T;
  }

  /** Spawn a private backend process (portable and development mode). */
  private async spawn(): Promise<RawAgentBackendState> {
    const backendBinary = await this.resolveBackendBinary();
    if (!backendBinary) {
      throw new BackendUnavailableError(
        "The packaged Agent backend is not available. CI must place it under resources/agent."
      );
    }

    const port = await reserveLoopbackPort();
    const bundleRoot = path.dirname(backendBinary);
    const localTokenFile = path.join(this.options.userDataPath, "agent-ui.local-token");
    await writeFile(localTokenFile, `${this.localToken}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(localTokenFile, 0o600).catch(() => undefined);
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.attached = false;
    this.attachedReadOnly = false;
    this.lastOutput = "";
    const child = spawn(
      backendBinary,
      [
        "--listen",
        `127.0.0.1:${port}`,
        "--bundle-root",
        bundleRoot,
        "--config-root",
        this.options.userDataPath,
        "--parent-pid",
        String(process.pid),
        "--local-token-file",
        localTokenFile
      ],
      {
        cwd: bundleRoot,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.appendOutput(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => this.appendOutput(chunk.toString("utf8")));
    child.once("error", (error) => {
      this.appendOutput(`[backend-error] ${error.message}\n`);
      appendDesktopDiagnostic("agent-backend-error", { error });
    });
    child.once("exit", (code, signal) => {
      this.appendOutput(`[backend-exit] code=${code ?? "null"} signal=${signal ?? "null"}\n`);
      appendDesktopDiagnostic("agent-backend-exit", { code, signal });
      if (this.child === child) {
        this.child = null;
        this.baseUrl = null;
        void unlink(localTokenFile).catch(() => undefined);
      }
    });

    try {
      await this.waitForBackend();
      const state = await this.getState();
      return { ...state, agentMode: "child" };
    } catch (error) {
      await this.forceStop(child);
      await unlink(localTokenFile).catch(() => undefined);
      throw new Error(`${error instanceof Error ? error.message : String(error)}${this.lastOutput ? `\n${this.lastOutput}` : ""}`);
    }
  }

  async getState(): Promise<RawAgentBackendState> {
    const state = await this.request<RawAgentBackendState>("/api/state");
    return { ...state, agentMode: this.mode };
  }

  async updateConfig(config: AgentBackendConfig): Promise<void> {
    this.assertWritable();
    await this.request("/api/config", {
      method: "PUT",
      body: JSON.stringify(config)
    });
  }

  async control(action: DesktopAgentControlAction): Promise<RawAgentBackendState> {
    this.assertWritable();
    const endpoint: Record<DesktopAgentControlAction, string> = {
      start: "/api/control/start",
      stop: "/api/control/stop",
      restart: "/api/control/restart",
      "check-connection": "/api/control/check-connection",
      "detect-probes": "/api/probes/detect"
    };
    // Hardware probing invokes a one-shot slow sensor scan. Keep the normal
    // control timeout for lifecycle/connection actions, but allow the probe
    // request to cover the backend's 25-second sensor-probe deadline.
    await this.request(endpoint[action], {
      method: "POST"
    }, action === "detect-probes" ? 45_000 : 10_000);
    return this.getState();
  }

  async cloudPush(): Promise<RawAgentBackendState> {
    this.assertWritable();
    await this.request("/api/cloud/push", {
      method: "POST"
    });
    return this.getState();
  }

  /**
   * Stop only a backend we spawned. A machine-scope service keeps running: it
   * is what reports this computer while nobody is logged in.
   */
  async stop(): Promise<void> {
    if (this.attached) {
      this.baseUrl = null;
      this.attached = false;
      this.attachedReadOnly = false;
      return;
    }
    await this.stopChildIfRunning();
  }

  get diagnosticOutput(): string {
    return this.lastOutput;
  }

  private async stopChildIfRunning(): Promise<void> {
    const child = this.child;
    const localTokenFile = path.join(this.options.userDataPath, "agent-ui.local-token");
    if (!child) {
      await unlink(localTokenFile).catch(() => undefined);
      return;
    }
    try {
      await this.request("/api/control/shutdown", { method: "POST" });
    } catch {
      // The backend may already be gone during application shutdown.
    }
    await this.waitForExit(child, 4_000);
    if (this.isProcessRunning(child)) await this.forceStop(child);
    this.child = null;
    this.baseUrl = null;
    await unlink(localTokenFile).catch(() => undefined);
  }

  /** Explain how to gain write access instead of failing silently. */
  private assertWritable(): void {
    if (!this.attachedReadOnly) return;
    throw new BackendPermissionError(
      `本机 Agent 服务由系统级服务运行，当前用户没有修改权限。请以管理员身份执行：${serviceCommandHint()}`,
      serviceCommandHint()
    );
  }

  private async request<T>(endpoint: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.baseUrl) throw new BackendUnavailableError("The local Agent backend is not running.");
    const requestHeaders = Object.fromEntries(new Headers(init.headers).entries());
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(this.localToken ? { "X-DSC-Local-Token": this.localToken } : {}),
        ...requestHeaders
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      const detail = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : response.statusText;
      throw new Error(`agent_backend_${response.status}:${detail}`);
    }
    return payload as T;
  }

  private async waitForBackend(): Promise<void> {
    const deadline = Date.now() + 10_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      if (!this.isRunning()) throw new Error("The Agent backend exited during startup.");
      try {
        await this.getState();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    throw new Error(`Timed out waiting for the Agent backend: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async resolveBackendBinary(): Promise<string | null> {
    const fileName = process.platform === "win32" ? "guanlan-agent.exe" : "guanlan-agent";
    const legacyFileName = process.platform === "win32" ? "device-state-console-agent-backend.exe" : "device-state-console-agent-backend";
    const candidates = [
      this.options.backendBinary,
      process.env.DSC_BACKEND_BINARY,
      path.join(this.options.resourcesPath, "agent", fileName),
      path.join(this.options.resourcesPath, "agent", legacyFileName),
      path.resolve(process.cwd(), "release", "desktop-agent", fileName),
      path.resolve(process.cwd(), "release", "desktop-agent", legacyFileName),
      path.resolve(process.cwd(), "agents", "bin", fileName),
      path.resolve(process.cwd(), "agents", "bin", legacyFileName)
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return path.resolve(candidate);
      } catch {
        // Continue through the known dev and packaged locations.
      }
    }
    return null;
  }

  private appendOutput(value: string): void {
    this.lastOutput = `${this.lastOutput}${value}`.slice(-12_000);
  }

  private isRunning(): boolean {
    return Boolean(this.child && this.isProcessRunning(this.child));
  }

  private isProcessRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
  }

  private async waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
    if (!this.isProcessRunning(child)) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async forceStop(child: ChildProcess): Promise<void> {
    if (!this.isProcessRunning(child)) return;
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      await new Promise<void>((resolve) => killer.once("exit", () => resolve()));
      return;
    }
    child.kill("SIGTERM");
  }
}

/** The exact command a user can run to change machine-scope settings. */
function serviceCommandHint(): string {
  if (process.platform === "win32") {
    const executable = path.join(process.env.ProgramFiles || "C:\\Program Files", "DeviceStateConsoleAgent", "bin", "guanlan-agent.exe");
    return `"${executable}" config set --hub <中枢地址> --key-stdin`;
  }
  return "sudo guanlan-agent config set --hub <中枢地址> --key-stdin";
}

/**
 * Build a state document from the redacted service status. The desktop shell can
 * still show health, paths and upload history; it simply has no secret and no
 * probe inventory until it can authenticate.
 */
export function synthesizeStateFromStatus(status: ServiceStatusPayload, configDir: string): RawAgentBackendState {
  const config: AgentBackendConfig = {
    configVersion: 1,
    connection: {
      serverUrl: status.hubServerUrl ?? "",
      secret: "",
      deviceId: status.deviceId ?? hostname(),
      hostname: status.hostname ?? hostname()
    },
    sampling: {
      normalIntervalSeconds: status.effectiveUploadIntervalSeconds ?? 30,
      slowIntervalSeconds: status.effectiveUploadIntervalSeconds ?? 30
    },
    enabledMetrics: [],
    enabledDeviceIds: {},
    instanceMetricConfig: {},
    probeSelections: [],
    cloudSyncEnabled: status.cloudSyncEnabled,
    dataRecordingEnabled: status.dataRecordingEnabled,
    autoRestartCollector: true,
    autoStartCollector: status.autoStartCollector
  };

  return {
    running: status.running,
    backendStartedAt: status.backendStartedAt ?? "",
    frontendParentPid: 0,
    childStartedAt: status.childStartedAt,
    connectionStatus: status.connectionStatus,
    lastUploadAt: status.lastUploadAt,
    cloudConfigPending: false,
    restartCount: status.restartCount,
    autoRestartPending: false,
    effectiveUploadIntervalSeconds: status.effectiveUploadIntervalSeconds ?? 30,
    lastIssueCount: 0,
    configPath: status.configPath ?? path.join(configDir, "agent-ui.config.json"),
    configFileExists: Boolean(status.configPath),
    syncStatePath: status.syncStatePath ?? path.join(configDir, "agent-ui.sync-state.json"),
    syncStateFileExists: Boolean(status.syncStatePath),
    diagnosticsPath: status.diagnosticsPath ?? path.join(configDir, "agent-ui.backend.log"),
    diagnosticsFileExists: Boolean(status.diagnosticsPath),
    pendingStatePath: status.pendingStatePath ?? path.join(configDir, "agent-ui.config.json.pending.jsonl.state.json"),
    pendingStateFileExists: status.pendingSamples > 0,
    pendingSampleCount: status.pendingSamples,
    pendingBytes: status.pendingBytes,
    oldestPendingAt: status.oldestPendingAt,
    lastUploadError: status.lastUploadError,
    config,
    supportedProbePlans: [],
    detectedTargets: [],
    temperatureSources: [],
    temperatureSensorBackends: [],
    agentMode: "service-readonly"
  };
}

function hostname(): string {
  try {
    return os.hostname();
  } catch {
    return "";
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error("Could not reserve a loopback port for the Agent backend.");
  return port;
}
