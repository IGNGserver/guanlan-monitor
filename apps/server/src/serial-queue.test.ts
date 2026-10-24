import assert from "node:assert/strict";
import test from "node:test";
import { forEachBounded, KeyedSerialQueue, QueueCapacityError } from "./serial-queue.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("late completion holds same-key ownership, while other keys progress", async () => {
  const queue = new KeyedSerialQueue();
  const blocked = deferred();
  const events: string[] = [];
  const first = queue.run("a", async () => { events.push("first"); await blocked.promise; events.push("settled"); });
  const second = queue.run("a", async () => { events.push("second"); });
  await queue.run("b", async () => { events.push("other"); });
  assert.deepEqual(events, ["first", "other"]);
  assert.equal(queue.size, 2);
  assert.equal(queue.activeKeys, 1);
  blocked.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "other", "settled", "second"]);
  assert.equal(queue.size, 0);
  assert.equal(queue.activeKeys, 0);
});

test("failures and synchronous throws release ownership without poisoning subsequent operations", async () => {
  const queue = new KeyedSerialQueue();
  const blocked = deferred();
  const error = new Error("synthetic");
  const first = queue.run("a", () => blocked.promise);
  const observed = assert.rejects(first, error);
  const second = queue.run("a", async () => 42);
  blocked.reject(error);
  await observed;
  assert.equal(await second, 42);
  await assert.rejects(queue.run("a", () => { throw error; }), error);
  assert.equal(queue.activeKeys, 0);
});

test("admission bounds both hot keys and the whole queue before invoking rejected closures", async () => {
  const queue = new KeyedSerialQueue(2, 3);
  const blocked = deferred();
  let rejectedStarted = false;
  const work = () => { rejectedStarted = true; return Promise.resolve(); };
  const first = queue.run("a", () => blocked.promise);
  const second = queue.run("a", async () => {});
  await assert.rejects(queue.run("a", work), QueueCapacityError);
  const third = queue.run("b", () => blocked.promise);
  await assert.rejects(queue.run("c", work), QueueCapacityError);
  assert.equal(rejectedStarted, false);
  blocked.resolve();
  await Promise.all([first, second, third]);
  assert.equal(queue.size, 0);
  await queue.run("c", work);
});

test("bounded workers finish all work and propagate errors after draining", async () => {
  let active = 0, maximum = 0, visited = 0;
  await assert.rejects(forEachBounded(Array.from({ length: 100 }, (_, index) => index), async (index) => {
    active++; maximum = Math.max(active, maximum);
    await Promise.resolve();
    active--; visited++;
    if (index === 3) throw new Error("synthetic");
  }, 4), AggregateError);
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.equal(visited, 100);
  await forEachBounded([], async () => assert.fail("empty"));
  await assert.rejects(forEachBounded([], async () => {}, 0), RangeError);
  assert.throws(() => new KeyedSerialQueue(0), RangeError);
});
