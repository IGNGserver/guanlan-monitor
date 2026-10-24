import type { MetricAccumulator, TimeSeriesRecord } from "./types.js";

/** Memoize the exact existing oracle, never approximate a rolling average.
 * Owners must invalidate after any sample mutation. Weak keys release retired
 * buckets; clones prevent response/repository callers from mutating the cache.
 */
export class AggregateSnapshots {
  private readonly snapshots = new WeakMap<MetricAccumulator, TimeSeriesRecord>();

  constructor(private readonly average: (samples: TimeSeriesRecord[], timestamp: number) => TimeSeriesRecord) {}

  invalidate(accumulator: MetricAccumulator) { this.snapshots.delete(accumulator); }

  read(accumulator: MetricAccumulator): TimeSeriesRecord {
    let snapshot = this.snapshots.get(accumulator);
    if (!snapshot) {
      snapshot = structuredClone(this.average(accumulator.samples, accumulator.bucketStartedAt));
      this.snapshots.set(accumulator, snapshot);
    }
    return structuredClone(snapshot);
  }
}
