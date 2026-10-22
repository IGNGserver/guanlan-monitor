import assert from "node:assert/strict";
import test from "node:test";
import {
  createSession,
  millisecondsUntilSessionExpiry,
  parseSessionValue,
  renewSession,
  safeEqual,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_RENEW_BEFORE_MS
} from "./auth.js";

const accessKey = "test-access-key-with-enough-entropy";
const issuedAt = new Date("2026-08-27T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function encode(session: object): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

test("sessions are accepted for the idle lifetime and bound to the current credential", () => {
  const session = createSession(accessKey, issuedAt);
  const encoded = encode(session);

  assert.deepEqual(parseSessionValue(encoded, accessKey, issuedAt.getTime() + 1_000), session);
  assert.deepEqual(
    parseSessionValue(encoded, accessKey, issuedAt.getTime() + SESSION_IDLE_TTL_MS - 1),
    session
  );
  assert.equal(parseSessionValue(encoded, "a-different-access-key", issuedAt.getTime() + 1_000), null);
  assert.equal(parseSessionValue(encoded, accessKey, issuedAt.getTime() + SESSION_IDLE_TTL_MS), null);
});

test("legacy eight-hour sessions keep working until their own expiry", () => {
  const legacy = {
    ...createSession(accessKey, issuedAt),
    expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString()
  };

  assert.deepEqual(parseSessionValue(encode(legacy), accessKey, issuedAt.getTime() + 60 * 60 * 1000), legacy);
  assert.equal(parseSessionValue(encode(legacy), accessKey, issuedAt.getTime() + 9 * 60 * 60 * 1000), null);
});

test("renewal slides the expiry without changing the issuing identity", () => {
  const session = createSession(accessKey, issuedAt);
  assert.equal(renewSession(session, issuedAt.getTime() + 1_000), null);

  const renewalAt = issuedAt.getTime() + SESSION_IDLE_TTL_MS - SESSION_RENEW_BEFORE_MS;
  const renewed = renewSession(session, renewalAt);
  assert.ok(renewed);
  assert.equal(renewed.issuedAt, session.issuedAt);
  assert.equal(renewed.credentialVersion, session.credentialVersion);
  assert.equal(Date.parse(renewed.expiresAt), renewalAt + SESSION_IDLE_TTL_MS);
  assert.deepEqual(parseSessionValue(encode(renewed), accessKey, renewalAt + 1), renewed);
});

test("renewal never extends beyond one year from the original login", () => {
  let session = createSession(accessKey, issuedAt);

  for (const day of [89, 178, 267]) {
    const renewed = renewSession(session, issuedAt.getTime() + day * DAY_MS);
    assert.ok(renewed);
    assert.equal(Date.parse(renewed.expiresAt), issuedAt.getTime() + (day + 90) * DAY_MS);
    session = renewed;
  }

  const capped = renewSession(session, issuedAt.getTime() + 356 * DAY_MS);
  assert.ok(capped);
  assert.equal(Date.parse(capped.expiresAt), issuedAt.getTime() + SESSION_ABSOLUTE_TTL_MS);

  assert.equal(renewSession(capped, issuedAt.getTime() + 364 * DAY_MS), null);
  assert.equal(parseSessionValue(encode(capped), accessKey, issuedAt.getTime() + SESSION_ABSOLUTE_TTL_MS), null);
  assert.equal(millisecondsUntilSessionExpiry(capped, issuedAt.getTime() + SESSION_ABSOLUTE_TTL_MS), 0);
});

test("sessions with manipulated timestamps or oversized lifetimes are rejected", () => {
  const session = createSession(accessKey, issuedAt);
  const oversized = {
    ...session,
    expiresAt: new Date(issuedAt.getTime() + SESSION_ABSOLUTE_TTL_MS + 1).toISOString()
  };
  const future = {
    ...session,
    issuedAt: new Date(issuedAt.getTime() + 10_000).toISOString()
  };

  assert.equal(parseSessionValue(encode(oversized), accessKey, issuedAt.getTime()), null);
  assert.equal(parseSessionValue(encode(future), accessKey, issuedAt.getTime()), null);
});

test("constant-time comparison handles unequal lengths without throwing", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "different"), false);
  assert.equal(safeEqual("", "different"), false);
});

test("session expiry delays never extend an expired or malformed session", () => {
  const now = Date.parse("2026-08-27T01:00:00.000Z");
  const session = createSession(accessKey, issuedAt);
  assert.equal(millisecondsUntilSessionExpiry(session, now), SESSION_IDLE_TTL_MS - 60 * 60 * 1000);
  assert.equal(millisecondsUntilSessionExpiry(session, Date.parse(session.expiresAt)), 0);
  assert.equal(millisecondsUntilSessionExpiry({ ...session, expiresAt: "invalid" }, now), 0);
  assert.equal(renewSession({ ...session, expiresAt: "invalid" }, now), null);
});
