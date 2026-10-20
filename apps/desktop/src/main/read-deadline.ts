/** Bound headers AND body, even for transports that ignore cancellation. */
export async function withReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>, signals: Array<AbortSignal | null | undefined> = [], timeoutMs = 15_000): Promise<T> {
  const abort = new AbortController();
  const forward = (event: Event) => abort.abort((event.target as AbortSignal).reason);
  const present = signals.filter((signal): signal is AbortSignal => !!signal);
  for (const signal of present) {
    if (signal.aborted) abort.abort(signal.reason);
    else signal.addEventListener("abort", forward, { once: true });
  }
  const timer = setTimeout(() => abort.abort(new Error("hub_request_timeout")), timeoutMs);
  let cancel = () => {};
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(abort.signal.reason ?? new Error("hub_request_cancelled"));
      if (abort.signal.aborted) cancel();
      else abort.signal.addEventListener("abort", cancel, { once: true });
    });
    return await Promise.race([interrupted, abort.signal.aborted ? interrupted : read(abort.signal)]);
  } finally {
    clearTimeout(timer);
    abort.signal.removeEventListener("abort", cancel);
    for (const signal of present) signal.removeEventListener("abort", forward);
  }
}
