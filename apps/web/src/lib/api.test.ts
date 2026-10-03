import assert from "node:assert/strict";
import test from "node:test";
import { apiFetch, ApiError } from "./api.ts";
test("a stalled request has a bounded timeout and never remains pending", async (t) => {
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  try {
    const pending = apiFetch("/api/auth/session");
    t.mock.timers.tick(12_000);
    await assert.rejects(pending, /request_timeout/);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});
test("timeout settles even if the transport ignores cancellation", async (t) => {
  const original = globalThis.fetch;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = () => new Promise(() => undefined);
  try {
    const pending = apiFetch("/api/auth/session");
    t.mock.timers.tick(12_000);
    await assert.rejects(pending, /request_timeout/);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});
test("a stalled response body is also bounded by the request deadline", async (t) => {
  const original = globalThis.fetch;
  let reading = false;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async () => ({ ok: true, json: () => { reading = true; return new Promise(() => undefined); } } as unknown as Response);
  try {
    const pending = apiFetch("/api/auth/session");
    await Promise.resolve();
    assert.equal(reading, true);
    t.mock.timers.tick(12_000);
    await assert.rejects(pending, /request_timeout/);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});
test("caller cancellation settles even if the transport ignores the signal", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => undefined);
  try {
    const controller = new AbortController();
    const pending = apiFetch("/api/auth/session", { signal: controller.signal });
    controller.abort(new Error("caller_cancelled"));
    await assert.rejects(pending, /caller_cancelled/);
    await assert.rejects(apiFetch("/api/auth/session", { signal: controller.signal }), /caller_cancelled/);
  } finally { globalThis.fetch = original; }
});
test("401 is distinct from connectivity failure and requests bypass HTTP cache", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.credentials, "include");
    assert.equal(init?.cache, "no-store");
    return new Response("{}", { status: 401 });
  };
  try { await assert.rejects(apiFetch("/api/auth/session"), (error: unknown) => error instanceof ApiError && error.status === 401); }
  finally { globalThis.fetch = original; }
});
