import assert from "node:assert/strict";
import test from "node:test";
import { SharedQueryWork } from "./query-work.js";
import { QueueCapacityError } from "./serial-queue.js";

test("identical reads join once, release after settlement and never cache stale values", async () => {
  const work = new SharedQueryWork(1, 2);
  let release!: (value: number) => void;
  let calls = 0;
  const operation = () => { calls++; return new Promise<number>((resolve) => { release = resolve; }); };
  const first = work.run("a", operation);
  assert.equal(work.run("a", operation), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(42);
  assert.equal(await first, 42);
  assert.equal(work.size, 0);
  assert.equal(await work.run("a", async () => 43), 43);
});

test("distinct reads are bounded and overload closures never start", async () => {
  const work = new SharedQueryWork(2, 3);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0, max = 0, started = 0;
  const operation = async () => {
    active++; max = Math.max(max, active); started++;
    await gate;
    active--;
    return 1;
  };
  const requests = [work.run("a", operation), work.run("b", operation), work.run("c", operation)];
  await Promise.resolve();
  assert.equal(started, 2);
  assert.equal(work.run("c", operation), requests[2]);
  await assert.rejects(work.run("d", operation), QueueCapacityError);
  release();
  await Promise.all(requests);
  assert.equal(max, 2);
  assert.equal(started, 3);
  assert.equal(work.size, 0);
});

test("failed and synchronously throwing reads free their slots and do not poison retries", async () => {
  const work = new SharedQueryWork(1, 2);
  const error = new Error("synthetic query failure");
  const first = work.run("a", () => { throw error; });
  const second = work.run("b", async () => 42);
  await assert.rejects(first, error);
  assert.equal(await second, 42);
  assert.equal(await work.run("a", async () => 43), 43);
  assert.throws(() => new SharedQueryWork(0), RangeError);
  assert.throws(() => new SharedQueryWork(4, 3), RangeError);
});
