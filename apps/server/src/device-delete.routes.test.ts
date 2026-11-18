import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerRoutes } from "./routes.js";
import { tolerateEmptyJsonBody } from "./empty-json-body.js";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { MetricsService } from "./services/metrics.js";
import type { DeviceRecord, Repositories } from "./types.js";

const record = (deviceId: string): DeviceRecord => ({
  deviceId, name: deviceId, status: "open", sortOrder: 0, group: null,
  registeredAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
});

test("device deletion and logout accept the bodyless JSON request the consoles send", async () => {
  const app = Fastify();
  tolerateEmptyJsonBody(app);
  const deleted: string[] = [];
  const revoked: string[] = [];
  const repositories = {
    devices: {
      getOpenDevice: async (deviceId: string) => record(deviceId),
      listOpenDevices: async () => [record("macos-dev2")],
      deleteDevice: async (deviceId: string) => { deleted.push(deviceId); }
    },
    realtime: {
      getDevice: async () => null,
      remove: async () => undefined
    },
    history: {}
  } as unknown as Repositories;
  const metricConfigs = { get: async () => null, set: async () => undefined };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, new MetricsService(repositories, () => undefined, metricConfigs), {
    metricConfigs,
    fanNotes: { get: async () => ({}), set: async () => undefined },
    removeLiveDevice: async (deviceId: string) => { revoked.push(deviceId); }
  });
  await app.ready();
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const headers = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  try {
    // The web, Electron and iOS consoles all declare JSON on a request that carries no body.
    // That combination used to be answered 400 before the route ran; the declaration must be
    // treated as "no body" instead of as broken JSON.
    const declared = await app.inject({
      method: "DELETE", url: "/api/devices/macos-dev2",
      headers: { ...headers, "content-type": "application/json" }
    });
    assert.equal(declared.statusCode, 200);
    assert.deepEqual(declared.json(), { ok: true });

    const plain = await app.inject({ method: "DELETE", url: "/api/devices/macos-dev2", headers });
    assert.equal(plain.statusCode, 200);

    // Requests that do carry bytes keep the strict parser.
    const malformed = await app.inject({
      method: "DELETE", url: "/api/devices/macos-dev2",
      headers: { ...headers, "content-type": "application/json" }, payload: "{"
    });
    assert.equal(malformed.statusCode, 400);

    assert.deepEqual(deleted, ["macos-dev2", "macos-dev2"]);
    assert.deepEqual(revoked, ["macos-dev2", "macos-dev2"]);

    const logout = await app.inject({
      method: "POST", url: "/api/auth/logout",
      headers: { ...headers, "content-type": "application/json" }
    });
    assert.equal(logout.statusCode, 200);
    assert.deepEqual(logout.json(), { ok: true });
  } finally { await app.close(); }
});
