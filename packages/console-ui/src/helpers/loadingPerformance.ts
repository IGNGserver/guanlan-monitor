/** Local User Timing only: fixed labels, no device IDs, URLs or telemetry. */
export type LoadingMilestone = "shell-committed" | "cache-committed" | "hub-summary-committed" | "hub-charts-committed";

interface Timeline {
  getEntriesByName(name: string): readonly unknown[];
  mark(name: string): unknown;
}

export function markLoadingMilestone(milestone: LoadingMilestone, timeline: Timeline | undefined = globalThis.performance): void {
  try {
    const name = `guanlan:${milestone}`;
    // Bound entries across polls, foregrounding and React StrictMode effects.
    if (timeline && !timeline.getEntriesByName(name).length) timeline.mark(name);
  } catch {
    // Diagnostics must never prevent startup in restricted runtimes.
  }
}
