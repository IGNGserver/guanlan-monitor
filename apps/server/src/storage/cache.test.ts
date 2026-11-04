import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTtlCache, estimateBytes } from "./cache.js";

test("bounded TTL cache clones values and invalidates by TTL", async () => {
  const cache = new BoundedTtlCache<{ value: number }>(8, 1024 * 1024, 40);
  const value = { value: 1 };
  cache.set("k", value);
  value.value = 99;
  const first = cache.get("k");
  assert.deepEqual(first, { value: 1 });
  first!.value = 42;
  assert.deepEqual(cache.get("k"), { value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(cache.get("k"), undefined);
  assert.equal(cache.stats().hits, 2);
  assert.equal(cache.stats().misses, 1);
});

test("bounded TTL cache evicts by entries and bytes and skips oversized values", () => {
  const cache = new BoundedTtlCache<string>(2, 512, 60_000);
  cache.set("a", "a".repeat(100));
  cache.set("b", "b".repeat(100));
  cache.set("c", "c".repeat(100));
  assert.equal(cache.stats().entries, 2);
  assert.ok(cache.stats().evictions >= 1);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "b".repeat(100));

  const tiny = new BoundedTtlCache<string>(10, 64, 60_000);
  const huge = "x".repeat(100);
  tiny.set("huge", huge);
  assert.equal(tiny.get("huge"), undefined);
  assert.ok(estimateBytes([{ value: 1 }]) > 0);
});

test("zero TTL disables the cache entirely", () => {
  const cache = new BoundedTtlCache<number>(4, 1024, 0);
  cache.set("a", 1);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.enabled, false);
});
