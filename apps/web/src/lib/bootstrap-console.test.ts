import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api.ts";
import { bootstrapConsole } from "./bootstrap-console.ts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test("read-only cache paints while session validation is stalled, then live refresh starts immediately", async () => {
  const network = deferred<void>(), cache = deferred<boolean>();
  const states: string[] = [];
  let live = 0, readOnlyShown = false;
  const pending = bootstrapConsole({ current: () => true, show: (state) => states.push(state),
    establishSession: () => network.promise,
    restoreOffline: async (current) => { const value = await cache.promise; readOnlyShown = value && current(); return readOnlyShown; },
    onLive: () => { live++; }
  });
  cache.resolve(true); await settle();
  assert.equal(readOnlyShown, true); assert.deepEqual(states, ["authenticated"]); assert.equal(live, 0);
  network.resolve(); await pending;
  assert.equal(live, 1);
});

test("401/403 override cached display and fence storage that completes after denial", async () => {
  for (const status of [401, 403]) {
    const network = deferred<void>(), cache = deferred<boolean>();
    const states: string[] = [];
    let restoredAfterDenial = false;
    const pending = bootstrapConsole({ current: () => true, show: (state) => states.push(state),
      establishSession: () => network.promise,
      restoreOffline: async (current) => { await cache.promise; restoredAfterDenial = current(); return restoredAfterDenial; }
    });
    network.reject(new ApiError(status)); await pending;
    cache.resolve(true); await settle();
    assert.equal(restoredAfterDenial, false); assert.deepEqual(states, ["anonymous"]);
  }
});

test("a late cache never downgrades live state and an obsolete bootstrap cannot change its replacement", async () => {
  const network = deferred<void>(), cache = deferred<boolean>();
  const states: string[] = [];
  let version = 1, restored = true;
  const pending = bootstrapConsole({ current: () => version === 1, show: (state) => states.push(state),
    establishSession: () => network.promise,
    restoreOffline: async (current) => { await cache.promise; restored = current(); return restored; }
  }, true);
  network.resolve(); await pending;
  cache.resolve(true); await settle();
  assert.equal(restored, false); assert.deepEqual(states, ["authenticated"]);
  version = 2;
  await bootstrapConsole({ current: () => version === 1, show: (state) => states.push(state), establishSession: async () => { throw new ApiError(401); }, restoreOffline: async () => false });
  assert.deepEqual(states, ["authenticated"]);
});

test("offline cache misses remain unavailable, not authenticated", async () => {
  const states: string[] = [];
  await bootstrapConsole({ current: () => true, show: (state) => states.push(state), establishSession: async () => { throw new TypeError("offline"); }, restoreOffline: async () => false });
  assert.deepEqual(states, ["unavailable"]);
});
