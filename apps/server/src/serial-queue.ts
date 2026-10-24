/** Explicit admission control: rejected work has not started and must be retried. */
export class QueueCapacityError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("hub_queue_capacity");
    this.name = "QueueCapacityError";
  }
}

/**
 * Ownership follows the actual operation, never a timeout race. A caller may
 * disconnect while a database operation is pending; later work must still wait.
 * The map holds only active keys and settled closures are released immediately.
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly counts = new Map<string, number>();
  private pending = 0;

  constructor(private readonly perKeyLimit = 32, private readonly totalLimit = 1_024) {
    if (!Number.isSafeInteger(perKeyLimit) || perKeyLimit < 1 || !Number.isSafeInteger(totalLimit) || totalLimit < 1) {
      throw new RangeError("queue limits must be positive safe integers");
    }
  }

  get size() { return this.pending; }
  get activeKeys() { return this.tails.size; }

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const count = this.counts.get(key) ?? 0;
    if (count >= this.perKeyLimit || this.pending >= this.totalLimit) return Promise.reject(new QueueCapacityError());
    this.counts.set(key, count + 1);
    this.pending++;
    const result = (this.tails.get(key) ?? Promise.resolve()).then(operation);
    const tail = result.then(() => undefined, () => undefined).then(() => {
      this.pending--;
      const remaining = (this.counts.get(key) ?? 1) - 1;
      if (remaining) this.counts.set(key, remaining);
      else this.counts.delete(key);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    // Complete admission accounting before a successful caller submits again.
    return result.then(async (value) => { await tail; return value; }, async (error: unknown) => {
      await tail;
      throw error;
    });
  }
}

/** Run all items without materializing one promise/DB waiter per device. */
export async function forEachBounded<T>(items: Iterable<T>, operation: (item: T) => Promise<void>, concurrency = 8): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("invalid concurrency");
  const iterator = items[Symbol.iterator]();
  const failures: unknown[] = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const next = iterator.next();
      if (next.done) return;
      try { await operation(next.value); } catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) {
    if (failures.every((error) => error instanceof QueueCapacityError)) throw new QueueCapacityError();
    throw new AggregateError(failures, "bounded operations failed");
  }
}
