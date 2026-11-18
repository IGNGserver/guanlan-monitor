import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerRoutes } from "./routes.js";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { MetricsService } from "./services/metrics.js";
import { DeviceIdConflictError, type DeviceRecord, type Repositories } from "./types.js";

const record = (deviceId: string): DeviceRecord => ({
  deviceId, name: deviceId, status: "open", sortOrder: 3, group: null,
  registeredAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z"
});

test("device rename is authenticated, refuses online devices and is idempotent on conflicts", async () => {
  const app = Fastify();
  let online = true;
  let conflict = false;
  const renames: string[] = [];
  const repositories = {
    devices: {
      getOpenDevice: async (deviceId: string) => record(deviceId),
      listOpenDevices: async () => [record("old")],
      renameDevice: async (deviceId: string, nextDeviceId: string) => {
        if (conflict) throw new DeviceIdConflictError(nextDeviceId);
        renames.push(`${deviceId}->${nextDeviceId}`);
        return record(nextDeviceId);
      }
    },
    realtime: {
      getDevice: async (deviceId: string) => online ? { identity: { deviceId }, status: "online" } : null,
      remove: async () => undefined
    },
    history: {}
  } as unknown as Repositories;
  const metricConfigs = { get: async () => null, set: async () => undefined };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, new MetricsService(repositories, () => undefined, metricConfigs), {
    metricConfigs,
    fanNotes: { get: async () => ({}), set: async () => undefined },
    removeLiveDevice: async () => undefined
  });
  await app.ready();
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const headers = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  const rename = (body: unknown) => app.inject({
    method: "PUT", url: "/api/devices/old/id", headers, payload: body as Record<string, unknown>
  });
  try {
    assert.equal((await app.inject({ method: "PUT", url: "/api/devices/old/id", payload: { deviceId: "new" } })).statusCode, 401);
    assert.equal((await rename({})).statusCode, 400);
    assert.equal((await rename({ deviceId: "vm:new" })).statusCode, 400);

    const refused = await rename({ deviceId: "new" });
    assert.equal(refused.statusCode, 409);
    assert.deepEqual(refused.json(), { error: "device_online" });

    online = false;
    const accepted = await rename({ deviceId: "new" });
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.json(), { ok: true, deviceId: "new" });
    assert.deepEqual(renames, ["old->new"]);

    conflict = true;
    const conflicted = await rename({ deviceId: "taken" });
    assert.equal(conflicted.statusCode, 409);
    assert.deepEqual(conflicted.json(), { error: "device_id_conflict" });
  } finally { await app.close(); }
});
