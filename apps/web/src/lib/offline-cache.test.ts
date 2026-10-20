import assert from "node:assert/strict";
import test from "node:test";
import { OfflineSnapshotCache } from "./offline-cache.ts";

test("blocked storage opens are bounded and concurrent cold reads share one open", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let opens = 0, closes = 0;
  const request: Record<string, unknown> = { result: { close: () => { closes++; } } };
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => { opens++; return request; } } });
  try {
    const cache = new OfflineSnapshotCache();
    const a = cache.restore(), b = cache.restore();
    assert.equal(opens, 1);
    t.mock.timers.tick(500);
    assert.deepEqual(await Promise.all([a, b]), [null, null]);
    (request.onsuccess as () => void)();
    assert.equal(closes, 1, "a connection that opens after timeout is closed");
  } finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original); else Reflect.deleteProperty(globalThis, "indexedDB");
    t.mock.timers.reset();
  }
});

test("logout tombstone blocks persisted snapshots even when IDB cannot complete deletion", async () => {
  const values = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    await new OfflineSnapshotCache().clear(); // IDB unavailable in this test process.
    assert.equal(values.get("dsc-web-offline-cleared"), "1");
    assert.equal(await new OfflineSnapshotCache().restore(), null);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
