interface Entry {
  key: string;
  signal?: AbortSignal;
  priority: number;
  start: () => Promise<unknown>;
  finish: (error?: unknown, value?: unknown) => void;
  promise: Promise<unknown>;
}

/** Only idempotent optional reads enter this queue. Auth/summary have a reserved
 * path; a calendar or update timeout can never starve the interactive summary.
 * Coalescing is scoped to the same cancellation lifetime, not just the URL.
 */
export class ReadQueue {
  private active = 0;
  private pending: Entry[] = [];
  private entries = new Map<string, Entry>();
  private limit = 2;

  setLimit(limit: number) { this.limit = Math.max(1, Math.min(2, limit)); this.drain(); }

  run<T>(key: string, read: () => Promise<T>, signal?: AbortSignal, priority = 1): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("request_cancelled"));
    const existing = this.entries.get(key);
    if (existing && existing.signal === signal) return existing.promise as Promise<T>;
    if (this.pending.length >= 32) return Promise.reject(new Error("read_queue_full"));
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    let running = false, settled = false;
    const entry: Entry = {
      key, signal, priority, promise, start: () => { running = true; return read(); },
      finish: (error, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        this.pending = this.pending.filter((item) => item !== entry);
        if (this.entries.get(key) === entry) this.entries.delete(key);
        if (running) this.active--;
        if (error !== undefined) reject(error); else resolve(value as T);
        this.drain();
      }
    };
    const cancel = () => entry.finish(signal?.reason ?? new Error("request_cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    this.entries.set(key, entry);
    this.pending.push(entry);
    this.drain();
    return promise;
  }

  private drain() {
    this.pending.sort((a, b) => a.priority - b.priority);
    while (this.active < this.limit && this.pending.length) {
      const entry = this.pending.shift()!;
      if (entry.signal?.aborted) { entry.finish(entry.signal.reason ?? new Error("request_cancelled")); continue; }
      this.active++;
      // Invoke start synchronously so cancellation always releases its slot.
      try { Promise.resolve(entry.start()).then((value) => entry.finish(undefined, value), (error) => entry.finish(error)); }
      catch (error) { entry.finish(error); }
    }
  }
}
