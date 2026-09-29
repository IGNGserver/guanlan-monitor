/**
 * Sample timestamps are ISO-8601 strings from the hub, so `Date.parse` is called
 * inside every aggregate, axis-range and segment computation. V8 caches only
 * recent parses, and the same points are re-parsed on every poll for every chart,
 * so a bounded map turns that repeated work into a lookup.
 *
 * The cache is deliberately small and self-invalidating: a long history window
 * cycles through many seconds and the oldest keys are dropped rather than grown.
 * A point whose timestamp is not a string (already a Date, or malformed) falls
 * back to `Date.parse`, preserving the existing behavior exactly.
 */
const CACHE_LIMIT = 4096;
const cache = new Map<string, number>();

export function dateValueOf(timestamp: string): number {
  const cached = cache.get(timestamp);
  if (cached !== undefined) return cached;
  const parsed = Date.parse(timestamp);
  if (cache.size >= CACHE_LIMIT) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(timestamp, parsed);
  return parsed;
}
