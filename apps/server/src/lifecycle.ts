import { millisecondsUntilSessionExpiry } from "./auth.js";
import type { SessionValue } from "./types.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function scheduleExpiry(remaining: () => number, onExpire: () => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    // Node otherwise clamps overflowing timeouts to 1ms. Recheck wall time at
    // every chunk, including after a backwards clock adjustment.
    timer = setTimeout(check, Math.min(MAX_TIMEOUT_MS, Math.max(0, remaining())));
    timer.unref();
  };

  const check = () => {
    timer = undefined;
    if (stopped) return;
    if (remaining() > 0) {
      schedule();
      return;
    }
    stopped = true;
    onExpire();
  };

  // Even already-expired sessions run asynchronously, allowing cancellation
  // before the callback and keeping the return value available to callers.
  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

export function scheduleAtDeadline(deadline: number, onExpire: () => void): () => void {
  return scheduleExpiry(
    () => Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0,
    onExpire
  );
}

export function scheduleSessionExpiry(session: SessionValue, onExpire: () => void): () => void {
  return scheduleExpiry(() => millisecondsUntilSessionExpiry(session), onExpire);
}

/** Share one in-flight run without hiding failures from any of its callers. */
export function nonOverlappingTask<T>(
  operation: () => T | Promise<T>,
  onError?: (error: unknown) => void
): (() => Promise<T>) & { drain: () => Promise<void> } {
  let inFlight: Promise<T> | undefined;
  const run = () => {
    if (inFlight) return inFlight;
    // Defer invocation so even synchronous throws/reentry see the same promise.
    inFlight = Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        onError?.(error);
        throw error;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
  return Object.assign(run, { drain: async () => { await inFlight; } });
}
