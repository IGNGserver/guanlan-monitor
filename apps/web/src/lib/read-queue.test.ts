import assert from "node:assert/strict";
import test from "node:test";
import { ReadQueue } from "./read-queue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("optional reads are bounded, coalesced per cancellation lifetime and priority ordered", async () => {
  const queue = new ReadQueue(); queue.setLimit(1);
  const first = deferred<string>(), order: string[] = [];
  const signal = new AbortController().signal;
  const a = queue.run("a", () => { order.push("a"); return first.promise; }, signal);
  assert.equal(queue.run("a", async () => "wrong duplicate", signal), a);
  const low = queue.run("low", async () => { order.push("low"); return "low"; }, signal, 3);
  const high = queue.run("high", async () => { order.push("high"); return "high"; }, signal, 1);
  assert.deepEqual(order, ["a"]);
  first.resolve("a");
  assert.deepEqual(await Promise.all([a, low, high]), ["a", "low", "high"]);
  assert.deepEqual(order, ["a", "high", "low"]);
});

test("cancellation settles running and queued reads even when an underlying transport ignores it", async () => {
  const queue = new ReadQueue(); queue.setLimit(1);
  const controller = new AbortController();
  const held = deferred<string>();
  const running = queue.run("running", () => held.promise, controller.signal);
  let queuedStarts = 0;
  const queued = queue.run("queued", async () => { queuedStarts++; return "no"; }, controller.signal);
  const rejected = Promise.all([assert.rejects(running, /cancel/), assert.rejects(queued, /cancel/)]);
  controller.abort(new Error("cancel"));
  await rejected;
  assert.equal(queuedStarts, 0);
  assert.equal(await queue.run("next", async () => "next"), "next");
  held.resolve("stale");
  await Promise.resolve();
  assert.equal(await queue.run("after", async () => "after"), "after");
});

test("different identities never share a result for the same resource key", async () => {
  const queue = new ReadQueue();
  const first = deferred<string>();
  const a = queue.run("same", () => first.promise, new AbortController().signal);
  const b = queue.run("same", async () => "new", new AbortController().signal);
  assert.equal(await b, "new");
  first.resolve("old"); assert.equal(await a, "old");
});
