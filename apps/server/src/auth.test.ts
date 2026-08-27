import assert from "node:assert/strict";
import test from "node:test";
import { createSession, parseSessionValue, safeEqual, SESSION_TTL_MS } from "./auth.js";

const accessKey = "test-access-key-with-enough-entropy";

test("sessions are accepted before expiry and bound to the current credential", () => {
  const issuedAt = new Date("2026-08-27T00:00:00.000Z");
  const session = createSession(accessKey, issuedAt);
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");

  assert.deepEqual(parseSessionValue(encoded, accessKey, issuedAt.getTime() + 1_000), session);
  assert.equal(parseSessionValue(encoded, "a-different-access-key", issuedAt.getTime() + 1_000), null);
  assert.equal(parseSessionValue(encoded, accessKey, issuedAt.getTime() + SESSION_TTL_MS), null);
});

test("sessions with manipulated timestamps or oversized lifetimes are rejected", () => {
  const issuedAt = new Date("2026-08-27T00:00:00.000Z");
  const session = createSession(accessKey, issuedAt);
  const oversized = {
    ...session,
    expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS + 1).toISOString()
  };
  const future = {
    ...session,
    issuedAt: new Date(issuedAt.getTime() + 10_000).toISOString()
  };

  assert.equal(
    parseSessionValue(Buffer.from(JSON.stringify(oversized)).toString("base64url"), accessKey, issuedAt.getTime()),
    null
  );
  assert.equal(
    parseSessionValue(Buffer.from(JSON.stringify(future)).toString("base64url"), accessKey, issuedAt.getTime()),
    null
  );
});

test("constant-time comparison handles unequal lengths without throwing", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "different"), false);
  assert.equal(safeEqual("", "different"), false);
});
