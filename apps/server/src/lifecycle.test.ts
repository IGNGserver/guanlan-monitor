import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from "./auth.js";
import { nonOverlappingTask, scheduleAtDeadline, scheduleSessionExpiry } from "./lifecycle.js";
import type { SessionValue } from "./types.js";

const NOW = Date.parse("2026-08-27T00:00:00.000Z");
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function sessionFor(duration: number): SessionValue {
  return {
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + duration).toISOString(),
    credentialVersion: "test-version"
  };
}

for (const [name, duration] of [
  ["90-day", SESSION_IDLE_TTL_MS],
  ["365-day", SESSION_ABSOLUTE_TTL_MS]
] as const) {
  test(`${name} sessions use bounded timers and never expire early`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
    const timeouts = t.mock.method(globalThis, "setTimeout");
    const expire = t.mock.fn();
    const cancel = scheduleSessionExpiry(sessionFor(duration), expire);

    let remaining = duration;
    while (remaining > MAX_TIMEOUT_MS) {
      t.mock.timers.tick(MAX_TIMEOUT_MS);
      remaining -= MAX_TIMEOUT_MS;
      assert.equal(expire.mock.callCount(), 0);
    }
    t.mock.timers.tick(remaining - 1);
    assert.equal(expire.mock.callCount(), 0);
    t.mock.timers.tick(1);
    assert.equal(expire.mock.callCount(), 1);

    assert.equal(timeouts.mock.callCount(), Math.ceil(duration / MAX_TIMEOUT_MS));
    for (const call of timeouts.mock.calls) {
      const delay = call.arguments[1];
      assert.ok(typeof delay === "number" && delay > 0 && delay <= MAX_TIMEOUT_MS);
    }
    cancel();
    cancel();
    t.mock.timers.tick(duration);
    assert.equal(expire.mock.callCount(), 1);
  });
}

test("expiry timers are unreferenced so they do not keep the process alive", (t) => {
  const unref = t.mock.fn();
  const timer = { unref } as unknown as ReturnType<typeof setTimeout>;
  t.mock.method(globalThis, "setTimeout", () => timer);
  const clear = t.mock.method(globalThis, "clearTimeout", () => {});
  const cancel = scheduleAtDeadline(Date.now() + 1_000, () => {});
  assert.equal(unref.mock.callCount(), 1);
  cancel();
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(clear.mock.calls[0].arguments[0], timer);
});

test("expiry cancellation is idempotent before and between timer chunks", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  for (const elapsed of [0, MAX_TIMEOUT_MS]) {
    const expire = t.mock.fn();
    const cancel = scheduleSessionExpiry(sessionFor(SESSION_IDLE_TTL_MS), expire);
    t.mock.timers.tick(elapsed);
    cancel();
    cancel();
    t.mock.timers.tick(SESSION_IDLE_TTL_MS);
    assert.equal(expire.mock.callCount(), 0);
    t.mock.timers.setTime(NOW);
  }
});

test("expired and malformed sessions expire asynchronously exactly once or can be cancelled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  for (const expiresAt of [new Date(NOW - 1).toISOString(), "invalid"]) {
    const session = { ...sessionFor(0), expiresAt };
    const expire = t.mock.fn();
    scheduleSessionExpiry(session, expire);
    assert.equal(expire.mock.callCount(), 0);
    t.mock.timers.tick(1);
    assert.equal(expire.mock.callCount(), 1);
    t.mock.timers.tick(MAX_TIMEOUT_MS);
    assert.equal(expire.mock.callCount(), 1);

    const cancelled = t.mock.fn();
    const cancel = scheduleSessionExpiry(session, cancelled);
    cancel();
    t.mock.timers.tick(1);
    assert.equal(cancelled.mock.callCount(), 0);
  }
});

test("a backwards wall clock reschedules instead of expiring at the old timer time", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const timeouts = t.mock.method(globalThis, "setTimeout");
  const expire = t.mock.fn();
  scheduleSessionExpiry(sessionFor(1_000), expire);
  // Keep elapsed timer time moving forwards while wall-clock time goes back.
  t.mock.method(Date, "now", () => new Date().getTime() - 10_000);
  t.mock.timers.tick(1_000);
  assert.equal(expire.mock.callCount(), 0);
  assert.equal(timeouts.mock.callCount(), 2);
  t.mock.timers.tick(9_999);
  assert.equal(expire.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(expire.mock.callCount(), 1);
});

test("callbacks recheck the current session expiry and forward clock changes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const session = sessionFor(1_000);
  const expire = t.mock.fn();
  scheduleSessionExpiry(session, expire);
  session.expiresAt = new Date(NOW + 2_000).toISOString();
  t.mock.timers.tick(1_000);
  assert.equal(expire.mock.callCount(), 0);
  t.mock.timers.setTime(NOW + 3_000);
  t.mock.timers.tick(1_000);
  assert.equal(expire.mock.callCount(), 1);
});

test("generic deadlines share bounded scheduling and reject invalid dates by expiring", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const expire = t.mock.fn();
  scheduleAtDeadline(NOW + MAX_TIMEOUT_MS + 10, expire);
  t.mock.timers.tick(MAX_TIMEOUT_MS);
  assert.equal(expire.mock.callCount(), 0);
  t.mock.timers.tick(10);
  assert.equal(expire.mock.callCount(), 1);

  for (const deadline of [NaN, Infinity, -Infinity]) {
    const invalid = t.mock.fn();
    scheduleAtDeadline(deadline, invalid);
    t.mock.timers.tick(1);
    assert.equal(invalid.mock.callCount(), 1);
  }
});

test("overlapping calls share one promise and successful completion permits another run", async () => {
  let finish!: (value: number) => void;
  let runs = 0;
  const task = nonOverlappingTask(() => {
    runs += 1;
    return new Promise<number>((resolve) => { finish = resolve; });
  });
  const first = task();
  assert.equal(task(), first);
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(task(), first);
  finish(42);
  assert.equal(await first, 42);

  const second = task();
  assert.notEqual(second, first);
  await Promise.resolve();
  assert.equal(runs, 2);
  finish(43);
  assert.equal(await second, 43);
});

test("failed overlapping calls reject, report once, and permit retry", async (t) => {
  const error = new Error("operation failed");
  const onError = t.mock.fn();
  let fail!: (error: Error) => void;
  let runs = 0;
  const task = nonOverlappingTask(() => {
    runs += 1;
    if (runs > 1) return Promise.resolve("retried");
    return new Promise<string>((_resolve, reject) => { fail = reject; });
  }, onError);
  const first = task();
  const overlapping = task();
  assert.equal(overlapping, first);
  const failures = [assert.rejects(first, error), assert.rejects(overlapping, error)];
  await Promise.resolve();
  fail(error);
  await Promise.all(failures);
  assert.equal(onError.mock.callCount(), 1);
  assert.equal(onError.mock.calls[0].arguments[0], error);
  assert.equal(await task(), "retried");
  assert.equal(runs, 2);
});

test("synchronous exceptions reject without an error handler and release the task", async () => {
  const error = new Error("synchronous failure");
  const task = nonOverlappingTask(() => { throw error; });
  const first = task();
  assert.equal(task(), first);
  await assert.rejects(first, error);
  const second = task();
  assert.notEqual(second, first);
  await assert.rejects(second, error);
});

test("synchronous operation reentry sees the in-flight promise", async () => {
  let reentered: Promise<number> | undefined;
  const task = nonOverlappingTask(() => {
    reentered = task();
    return 42;
  });
  const first = task();
  assert.equal(await first, 42);
  assert.equal(reentered, first);
});

test("draining joins only existing maintenance and never starts a new run", async () => {
  let release!: () => void;
  let runs = 0;
  const task = nonOverlappingTask(() => { runs++; return new Promise<void>((resolve) => { release = resolve; }); });
  await task.drain();
  assert.equal(runs, 0);
  const active = task();
  let drained = false;
  const drain = task.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  release();
  await Promise.all([active, drain]);
  await task.drain();
  assert.equal(runs, 1);
});
