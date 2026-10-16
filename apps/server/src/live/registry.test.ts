import test from "node:test";
import assert from "node:assert/strict";
import { LiveRegistry, LIVE_LEASE_MS, LIVE_RESULT_TTL_MS, LIVE_TAKEOVER_LIMIT, LIVE_TAKEOVER_WINDOW_MS, type LiveTransport } from "./registry.js";
import type { LiveProcesses } from "@dsc/shared";

const data: LiveProcesses = { observedAt: new Date().toISOString(), cpuScale: "host", memoryKind: "rss", totalCount: 0, truncated: false, items: [] };
function transport() {
  let open = true;
  const messages: Array<Record<string, unknown>> = [];
  const wire: LiveTransport = { isOpen: () => open, send: (message) => { messages.push(message as Record<string, unknown>); }, close: () => { open = false; } };
  return { wire, messages };
}

test("a durable online flag cannot create a connection or a successful query", async () => {
  const registry = new LiveRegistry();
  assert.equal(registry.describe("database-online-device").state, "disconnected");
  await assert.rejects(registry.read("database-online-device", "metrics"), /device_not_connected/);
});

test("queries require ready and capability; viewers share the in-flight request and a short-lived result", async () => {
  let now = 0;
  const registry = new LiveRegistry(() => now); const wire = transport(); const session = registry.attach("node", wire.wire);
  await assert.rejects(registry.read("node", "processes"), /device_not_connected/);
  registry.ready(session, ["processes"]);
  await assert.rejects(registry.read("node", "docker"), /device_capability_unavailable/);
  const first = registry.read("node", "processes");
  assert.equal(first, registry.read("node", "processes"));
  const id = wire.messages[0].requestId as string;
  registry.result(session, id, "processes", data); // No application ACK: not a success.
  assert.equal(session.pending.size, 1);
  registry.acknowledge(session, id);
  registry.result(session, id, "docker", data); // Wrong topic cannot fulfil it either.
  assert.equal(session.pending.size, 1);
  registry.result(session, id, "processes", data);
  const result = await first;
  assert.equal(result.sessionId, session.id); assert.deepEqual(result.data, data);
  await Promise.resolve();
  now += LIVE_RESULT_TTL_MS - 1;
  assert.equal((await registry.read("node", "processes")).requestId, result.requestId, "a fresh result is shared, not re-collected");
  assert.equal(wire.messages.length, 1);
  now += 1;
  const next = registry.read("node", "processes");
  assert.equal(wire.messages.length, 2);
  const failed = assert.rejects(next, /device_disconnected/);
  registry.close(); await failed;
});

test("only a matching, unexpired heartbeat challenge renews the lease", async () => {
  let now = 0; const registry = new LiveRegistry(() => now); const wire = transport(); const session = registry.attach("node", wire.wire);
  registry.ready(session, ["processes"]); registry.heartbeat(session);
  const challenge = wire.messages[0].nonce as string;
  now = 5_000; registry.pong(session, "wrong"); assert.equal(session.expiresAt, LIVE_LEASE_MS);
  registry.pong(session, challenge); assert.equal(session.expiresAt, now + LIVE_LEASE_MS);
  now += LIVE_LEASE_MS; registry.pong(session, challenge);
  assert.equal(registry.describe("node").state, "disconnected");
  await assert.rejects(registry.read("node", "processes"), /device_not_connected/);
});

test("a reconnect replaces the stale session; old cleanup and results cannot damage the replacement", async () => {
  const registry = new LiveRegistry(); const oldWire = transport(); const old = registry.attach("node", oldWire.wire);
  registry.ready(old, ["processes"]);
  const query = registry.read("node", "processes"); const rejected = assert.rejects(query, /device_disconnected/);
  const oldRequest = oldWire.messages[0].requestId as string;
  const nextWire = transport(); const next = registry.attach("node", nextWire.wire);
  await rejected;
  assert.equal(oldWire.wire.isOpen(), false, "the replaced transport is closed");
  registry.ready(next, ["processes"]);
  registry.detach(old); registry.result(old, oldRequest, "processes", data);
  assert.equal(registry.describe("node").sessionId, next.id);
  assert.equal(nextWire.messages.length, 0); // Old requests were not replayed.
  registry.close();
});

test("send failure is not delivery; timeouts distinguish receipt from result", async () => {
  const registry = new LiveRegistry(undefined, 10);
  const broken = registry.attach("broken", { isOpen: () => true, send: () => { throw new Error("socket failed"); }, close: () => undefined });
  registry.ready(broken, ["processes"]);
  await assert.rejects(registry.read("broken", "processes"), /device_disconnected/);
  const wire = transport(); const session = registry.attach("node", wire.wire); registry.ready(session, ["processes"]);
  const keepAlive = setTimeout(() => undefined, 200);
  try {
    await assert.rejects(registry.read("node", "processes"), /device_ack_timeout/);
    const pending = registry.read("node", "processes");
    registry.acknowledge(session, wire.messages.at(-1)!.requestId as string);
    await assert.rejects(pending, /device_response_timeout/);
  } finally { clearTimeout(keepAlive); registry.close(); }
});

test("a delayed timer callback cannot admit a result after its monotonic deadline", async () => {
  let now = 0;
  const registry = new LiveRegistry(() => now, 1000); const wire = transport();
  const session = registry.attach("node", wire.wire); registry.ready(session, ["processes"]);
  const pending = registry.read("node", "processes");
  const id = wire.messages[0].requestId as string;
  registry.acknowledge(session, id);
  now = 1001;
  registry.result(session, id, "processes", data);
  await assert.rejects(pending, /device_response_timeout/);
  registry.close();
});

test("an identity that keeps taking over its own session is refused instead of flip-flopping", () => {
  let now = 0; const registry = new LiveRegistry(() => now);
  registry.ready(registry.attach("node", transport().wire), ["processes"]);
  for (let index = 0; index < LIVE_TAKEOVER_LIMIT; index++) { now += 1_000; registry.ready(registry.attach("node", transport().wire), ["processes"]); }
  now += 1_000;
  assert.throws(() => registry.attach("node", transport().wire), /device_session_conflict/);
  assert.equal(registry.describe("node").state, "ready", "the refused copy does not disturb the current session");
  now += LIVE_TAKEOVER_WINDOW_MS;
  assert.doesNotThrow(() => registry.attach("node", transport().wire));
  registry.close();
});

test("a rejected result fails its own request and leaves the session usable", async () => {
  let now = 0; const registry = new LiveRegistry(() => now); const wire = transport(); const session = registry.attach("node", wire.wire);
  registry.ready(session, ["processes"]);
  const failed = registry.read("node", "processes");
  registry.fail(session, wire.messages[0].requestId as string, "invalid_result");
  await assert.rejects(failed, /invalid_result/);
  assert.equal(registry.describe("node").state, "ready");
  const retried = registry.read("node", "processes");
  assert.equal(wire.messages.length, 2, "a failure is not cached as a result");
  const id = wire.messages[1].requestId as string;
  registry.acknowledge(session, id); registry.result(session, id, "processes", data);
  assert.equal((await retried).requestId, id);
  registry.close();
});
