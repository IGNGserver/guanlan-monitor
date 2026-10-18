import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import type { Duplex } from "node:stream";
import { setImmediate } from "node:timers/promises";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Server as SocketIOServer } from "socket.io";
import { AgentCredentials } from "./credentials.js";
import { LiveRegistry } from "./registry.js";
import { registerLiveRoutes } from "./routes.js";
import { createSession } from "../auth.js";
import { env } from "../config.js";

test("authenticated live HTTP/WS round trip, identity conflicts, payload validation and disconnect", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-routes-"));
  const app = Fastify();
  const credentials = new AgentCredentials(join(directory, "keys.json"), env.ACCESS_KEY); await credentials.load();
  let now = 0;
  const registry = new LiveRegistry(() => now);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerLiveRoutes(app, { accessKey: env.ACCESS_KEY, requireHttps: false, credentials, registry });
  await app.ready();
  t.after(async () => { registry.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const viewer = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  assert.equal((await app.inject({ url: "/api/devices/node/live" })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/devices/node/live/processes", headers: viewer })).statusCode, 503);
  await assert.rejects(app.injectWS("/api/agent/realtime"), /401/);
  const identity = { deviceId: "node", instanceId: "bd172f20-21cc-4db5-bd67-02e83088b416", token: "a".repeat(64) };
  assert.equal((await app.inject({ method: "POST", url: "/api/agent/enroll", payload: identity })).statusCode, 401);
  const enrollment = { method: "POST" as const, url: "/api/agent/enroll", headers: { authorization: `Bearer ${env.ACCESS_KEY}` } };
  assert.equal((await app.inject({ ...enrollment, payload: identity })).statusCode, 200);
  assert.equal((await app.inject({ ...enrollment, payload: { ...identity, instanceId: "bd172f20-21cc-4db5-bd67-02e83088b417" } })).statusCode, 409);
  assert.ok((await app.inject({ url: "/api/devices/node/live", headers: viewer })).json().identityConflictAt, "the console can see why the device has no live channel");
  assert.equal((await app.inject({ method: "POST", url: "/api/devices/node/live/reset", payload: {} })).statusCode, 401);
  const agent = await app.injectWS("/api/agent/realtime", { headers: { authorization: `Bearer ${identity.token}`, "x-device-id": identity.deviceId, "x-instance-id": identity.instanceId } });
  const welcome = once(agent, "message");
  agent.send(JSON.stringify({ type: "hello", protocolVersion: 1, capabilities: ["processes"] }));
  const hello = JSON.parse((await welcome)[0].toString()) as { sessionId: string; revision: number };
  assert.equal(hello.revision, 4, "Agents only send revision-4 shapes after the Hub announces them");
  agent.send(JSON.stringify({ type: "ready", sessionId: hello.sessionId }));
  await setImmediate(); await setImmediate();
  assert.equal(registry.describe("node").state, "ready");
  const frame = once(agent, "message");
  const read = app.inject({ url: "/api/devices/node/live/processes", headers: viewer });
  // Start the lazy injection before waiting for its outbound request.
  const completion = read.then((response) => response);
  const request = JSON.parse((await frame)[0].toString()) as { requestId: string };
  agent.send(JSON.stringify({ type: "ack", sessionId: hello.sessionId, requestId: request.requestId }));
  agent.send(JSON.stringify({ type: "result", sessionId: hello.sessionId, requestId: request.requestId, topic: "processes", data: { observedAt: new Date().toISOString(), cpuScale: "host", memoryKind: "rss", totalCount: 0, truncated: false, items: [] } }));
  const response = await completion;
  assert.equal(response.statusCode, 200); assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.json().sessionId, hello.sessionId);
  assert.deepEqual(response.json().data.items, []);
  const shared = await app.inject({ url: "/api/devices/node/live/processes", headers: viewer });
  assert.equal(shared.json().requestId, response.json().requestId, "a viewer within the result TTL shares the last collection");
  now += 1_000;
  agent.send(JSON.stringify({ type: "notice-from-a-newer-agent", sessionId: hello.sessionId }));
  const frame2 = once(agent, "message");
  const bad = app.inject({ url: "/api/devices/node/live/processes", headers: viewer }).then((value) => value);
  const request2 = JSON.parse((await frame2)[0].toString()) as { requestId: string };
  agent.send(JSON.stringify({ type: "ack", sessionId: hello.sessionId, requestId: request2.requestId }));
  agent.send(JSON.stringify({ type: "result", sessionId: hello.sessionId, requestId: request2.requestId, topic: "processes", data: { items: "not-a-process-list" } }));
  const rejected = await bad;
  assert.equal(rejected.statusCode, 502); assert.equal(rejected.json().error, "invalid_result");
  assert.equal(registry.describe("node").state, "ready", "one invalid result must not tear down the session");
  agent.send(JSON.stringify({ type: "pong", sessionId: hello.sessionId }));
  await setImmediate(); await setImmediate();
  assert.equal(registry.describe("node").state, "disconnected", "a malformed known frame is still a protocol violation");
});

test("the raw agent upgrade router does not hijack the existing Socket.IO transport", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-coexist-"));
  const app = Fastify(); const registry = new LiveRegistry();
  const credentials = new AgentCredentials(join(directory, "keys.json"), env.ACCESS_KEY);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerLiveRoutes(app, { accessKey: env.ACCESS_KEY, requireHttps: false, credentials, registry });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const io = new SocketIOServer(app.server, { path: "/socket.io", addTrailingSlash: false, destroyUpgrade: false });
  const socket = new WebSocket(`${address.replace("http:", "ws:")}/socket.io/?EIO=4&transport=websocket`);
  t.after(async () => { socket.close(); io.close(); registry.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const packet = await new Promise<string>((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  assert.ok(packet.startsWith("0{"), "existing Engine.IO handshake remains reachable");
  const identity = { deviceId: "real-upgrade", instanceId: "bd172f20-21cc-4db5-bd67-02e83088b416", token: "b".repeat(64) };
  await credentials.enroll(identity.deviceId, identity.instanceId, identity.token);
  let extensions: string | undefined;
  const agentSocket = await new Promise<Duplex>((resolve, reject) => {
    const request = httpRequest(`${address}/api/agent/realtime`, { headers: {
      connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13",
      "sec-websocket-key": Buffer.alloc(16, 7).toString("base64"),
      "sec-websocket-extensions": "permessage-deflate; client_no_context_takeover",
      authorization: `Bearer ${identity.token}`, "x-device-id": identity.deviceId, "x-instance-id": identity.instanceId
    } });
    request.once("upgrade", (response, stream) => { extensions = response.headers["sec-websocket-extensions"]; resolve(stream); });
    request.once("error", reject);
    request.once("response", (response) => reject(new Error(`agent upgrade returned HTTP ${response.statusCode}`)));
    request.end();
  });
  t.after(() => agentSocket.destroy());
  assert.equal(registry.describe(identity.deviceId).state, "connecting", "real agent upgrades also reach their independent authenticated handler");
  assert.match(extensions ?? "", /permessage-deflate/, "large process/container lists are compressed on the wire");
});

test("resetting live credentials lets a reinstalled Agent enroll and drops the old session", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "live-reset-"));
  const app = Fastify();
  const credentials = new AgentCredentials(join(directory, "keys.json"), env.ACCESS_KEY); await credentials.load();
  const registry = new LiveRegistry();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerLiveRoutes(app, { accessKey: env.ACCESS_KEY, requireHttps: false, credentials, registry });
  await app.ready();
  t.after(async () => { registry.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const viewer = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  const enrollment = { method: "POST" as const, url: "/api/agent/enroll", headers: { authorization: `Bearer ${env.ACCESS_KEY}` } };
  const original = { deviceId: "node", instanceId: "bd172f20-21cc-4db5-bd67-02e83088b416", token: "c".repeat(64) };
  const reinstalled = { ...original, instanceId: "bd172f20-21cc-4db5-bd67-02e83088b418", token: "d".repeat(64) };
  assert.equal((await app.inject({ ...enrollment, payload: original })).statusCode, 200);
  const agent = await app.injectWS("/api/agent/realtime", { headers: { authorization: `Bearer ${original.token}`, "x-device-id": original.deviceId, "x-instance-id": original.instanceId } });
  const closed = once(agent, "close");
  assert.equal((await app.inject({ ...enrollment, payload: reinstalled })).statusCode, 409);
  const reset = await app.inject({ method: "POST", url: "/api/devices/node/live/reset", headers: viewer, payload: {} });
  assert.equal(reset.statusCode, 200);
  await closed;
  assert.equal((await app.inject({ url: "/api/devices/node/live", headers: viewer })).json().identityConflictAt, null);
  assert.equal((await app.inject({ ...enrollment, payload: reinstalled })).statusCode, 200);
  assert.equal(credentials.verify("node", original.instanceId, original.token), false, "the replaced installation can no longer connect");
});
