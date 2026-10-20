export type NetworkMode = "auto" | "standard" | "saver";
export interface ConnectionHints { saveData?: boolean; effectiveType?: string; rtt?: number; downlink?: number; }

/** Request duration includes Hub work; it is not a measurement of network RTT. */
export function networkPolicy(mode: NetworkMode, durationMs = 0, hints: ConnectionHints = {}) {
  const constrained = mode === "saver" || (mode === "auto" && (
    hints.saveData === true || ["slow-2g", "2g", "3g"].includes(hints.effectiveType ?? "")
    || (hints.rtt ?? 0) >= 300 || (hints.downlink != null && hints.downlink > 0 && hints.downlink <= 1)
    || durationMs >= 1500
  ));
  return { constrained, concurrency: constrained ? 1 : 2, minimumPollMs: constrained ? 30_000 : 0,
    pointBudget: constrained ? 120 : undefined, pushIntervalMs: constrained ? 30_000 : 5_000 };
}

export function pollDelay(baseMs: number, minimumMs: number, failures = 0) {
  return Math.min(120_000, Math.max(baseMs, minimumMs) * 2 ** Math.min(4, Math.max(0, failures)));
}

export function storedNetworkMode(): NetworkMode {
  try {
    const value = typeof window === "undefined" ? null : localStorage.getItem("dsc-network-mode");
    return value === "standard" || value === "saver" ? value : "auto";
  } catch { return "auto"; }
}
