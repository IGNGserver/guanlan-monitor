import { spawnSync } from "node:child_process";
import type { DesktopMemoryPressure, DesktopRuntimeProfile } from "@dsc/shared";

export interface DesktopSystemMemoryInfo {
  total: number;
  free: number;
  swapTotal: number;
  swapFree: number;
}

type ElectronProcess = NodeJS.Process & {
  getSystemMemoryInfo?: () => {
    total?: number;
    free?: number;
    swapTotal?: number;
    swapFree?: number;
  };
};

export function readSystemMemoryInfo(): DesktopSystemMemoryInfo | null {
  const electronProcess = process as ElectronProcess;
  if (typeof electronProcess.getSystemMemoryInfo !== "function") return null;
  try {
    const info = electronProcess.getSystemMemoryInfo();
    const values = {
      total: Number(info.total ?? 0),
      free: Number(info.free ?? 0),
      swapTotal: Number(info.swapTotal ?? 0),
      swapFree: Number(info.swapFree ?? 0)
    };
    if (!Object.values(values).every(Number.isFinite)) return null;
    return values;
  } catch {
    return null;
  }
}

function hasActiveRdpSession(): boolean {
  const result = spawnSync("query.exe", ["session"], {
    encoding: "utf8",
    timeout: 1_500,
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });
  const output = typeof result.stdout === "string" ? result.stdout : "";
  return output.split(/\r?\n/).some((line) => /rdp-tcp#\d+/i.test(line));
}

export function isWindowsRemoteSession(): boolean {
  if (process.platform !== "win32") return false;
  const sessionName = process.env.SESSIONNAME?.trim() ?? "";
  const clientName = process.env.CLIENTNAME?.trim() ?? "";
  if (/^RDP-/i.test(sessionName) || Boolean(clientName && !/^(console|unknown)$/i.test(clientName))) return true;
  try {
    return hasActiveRdpSession();
  } catch {
    return false;
  }
}

function memoryPressure(info: DesktopSystemMemoryInfo | null): DesktopMemoryPressure {
  if (!info || info.total <= 0) return "normal";
  const freePhysicalRatio = info.free / info.total;
  const freeSwapRatio = info.swapTotal > 0 ? info.swapFree / info.swapTotal : 1;
  if (freePhysicalRatio < 0.05 || freeSwapRatio < 0.05) return "critical";
  if (freePhysicalRatio < 0.12 || freeSwapRatio < 0.12) return "elevated";
  return "normal";
}

export function getDesktopRuntimeProfile(gpuFallbackActive: boolean): DesktopRuntimeProfile {
  const isRemoteSession = isWindowsRemoteSession();
  const pressure = memoryPressure(readSystemMemoryInfo());
  const constrained = isRemoteSession || pressure !== "normal";
  return {
    isRemoteSession,
    memoryPressure: pressure,
    recommendedRefreshInterval: constrained ? 30 : 5,
    chartPointLimit: pressure === "critical" || isRemoteSession ? 120 : pressure === "elevated" ? 180 : 240,
    useOpaqueWindow: gpuFallbackActive || constrained
  };
}
