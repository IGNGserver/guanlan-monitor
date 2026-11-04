export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  bytes: number;
  evictions: number;
}

interface CacheEntry<T> {
  value: T;
  bytes: number;
  expiresAt: number;
}

/**
 * Small bounded TTL/LRU cache for read models.
 *
 * Values are cloned on entry and on hit so a caller can never mutate the
 * cached graph. Oversized or non-finite values bypass the cache rather than
 * risking the hub heap; TTL zero disables the cache.
 */
export class BoundedTtlCache<T = unknown> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly maxEntries = 512,
    private readonly maxBytes = 64 * 1024 * 1024,
    private readonly ttlMs = 15_000
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("maxEntries must be a positive integer");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive integer");
  }

  get enabled() {
    return this.ttlMs > 0;
  }

  get(key: string): T | undefined {
    if (!this.enabled) return undefined;
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) {
        this.bytes -= entry.bytes;
        this.entries.delete(key);
      }
      this.misses++;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return structuredClone(entry.value);
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (!this.enabled || ttlMs <= 0) return;
    const cloned = structuredClone(value);
    const bytes = estimateBytes(cloned);
    if (bytes > this.maxBytes) return;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes;
    this.entries.delete(key);
    this.entries.set(key, { value: cloned, bytes, expiresAt: Date.now() + ttlMs });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string): void {
    const previous = this.entries.get(key);
    if (!previous) return;
    this.bytes -= previous.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      bytes: this.bytes,
      evictions: this.evictions
    };
  }

  private evict() {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      const entry = this.entries.get(oldest);
      if (entry) this.bytes -= entry.bytes;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}

/** Conservative UTF-16 JSON size estimate, including array/object overhead. */
export function estimateBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : json.length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
