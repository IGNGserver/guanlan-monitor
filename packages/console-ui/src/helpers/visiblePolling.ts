/** Pause UI-only work while hidden; resume immediately without overlapping runs. */
export function startVisiblePolling(
  task: () => Promise<unknown>,
  intervalMs: number,
  immediate = false,
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && !visibility.hidden) timer = setTimeout(() => void tick(), intervalMs);
  };
  const tick = async () => {
    clear();
    if (stopped || running || visibility.hidden) return;
    running = true;
    try {
      await task();
    } catch {
      // Callers own error presentation. A failed read must not stop polling.
    } finally {
      running = false;
      schedule();
    }
  };
  const onVisibility = () => {
    clear();
    if (!visibility.hidden) void tick();
  };
  visibility.addEventListener("visibilitychange", onVisibility);
  if (immediate) void tick();
  else schedule();
  return () => {
    stopped = true;
    clear();
    visibility.removeEventListener("visibilitychange", onVisibility);
  };
}
