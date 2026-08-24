import { createServer } from "node:net";
import { access, chmod, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { DesktopAgentControlAction } from "@dsc/shared";
import { appendDesktopDiagnostic } from "./diagnostics.js";
import type { AgentBackendConfig, RawAgentBackendState } from "./types.js";

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

interface AgentManagerOptions {
  userDataPath: string;
  resourcesPath: string;
  backendBinary?: string;
}

export class AgentManager {
  private child: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private readonly localToken = randomBytes(32).toString("hex");
  private lastOutput = "";

  constructor(private readonly options: AgentManagerOptions) {}

  get localEndpoint(): string | null {
    return this.baseUrl;
  }

  async start(): Promise<RawAgentBackendState> {
    if (this.isRunning()) return this.getState();

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
      return await this.getState();
    } catch (error) {
      await this.forceStop(child);
      await unlink(localTokenFile).catch(() => undefined);
      throw new Error(`${error instanceof Error ? error.message : String(error)}${this.lastOutput ? `\n${this.lastOutput}` : ""}`);
    }
  }

  async getState(): Promise<RawAgentBackendState> {
    return this.request<RawAgentBackendState>("/api/state");
  }

  async updateConfig(config: AgentBackendConfig): Promise<void> {
    await this.request("/api/config", {
      method: "PUT",
      body: JSON.stringify(config)
    });
  }

  async control(action: DesktopAgentControlAction): Promise<RawAgentBackendState> {
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
    await this.request("/api/cloud/push", {
      method: "POST"
    });
    return this.getState();
  }

  async stop(): Promise<void> {
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

  get diagnosticOutput(): string {
    return this.lastOutput;
  }

  private async request<T>(endpoint: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.baseUrl) throw new BackendUnavailableError("The local Agent backend is not running.");
    const requestHeaders = Object.fromEntries(new Headers(init.headers).entries());
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-DSC-Local-Token": this.localToken,
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
    const fileName = process.platform === "win32" ? "device-state-console-agent-backend.exe" : "device-state-console-agent-backend";
    const candidates = [
      this.options.backendBinary,
      process.env.DSC_BACKEND_BINARY,
      path.join(this.options.resourcesPath, "agent", fileName),
      path.resolve(process.cwd(), "release", "desktop-agent", fileName),
      path.resolve(process.cwd(), "agents", "bin", fileName)
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
