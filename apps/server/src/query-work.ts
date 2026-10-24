import { QueueCapacityError } from "./serial-queue.js";

/** Bound distinct in-flight/queued reads; only concurrent identical reads join.
 * No settled values survive, so a successful write is visible to the next read.
 */
export class SharedQueryWork {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly waiting: Array<() => void> = [];
  private active = 0;

  constructor(private readonly concurrency = 4, private readonly capacity = 128) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(capacity) || capacity < concurrency) {
      throw new RangeError("invalid query work limits");
    }
  }

  get size() { return this.pending.size; }

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const joined = this.pending.get(key);
    if (joined) return joined as Promise<T>;
    if (this.pending.size >= this.capacity) return Promise.reject(new QueueCapacityError());
    const result = new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        // Defer invocation so the map is set before synchronous reentry.
        void Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push(start);
    });
    const tracked = result.finally(() => { if (this.pending.get(key) === tracked) this.pending.delete(key); });
    this.pending.set(key, tracked);
    return tracked;
  }
}
