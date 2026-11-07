import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { registerRoutes } from "./routes.js";
import { MetricsService } from "./services/metrics.js";
import type { Repositories } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function setCookieHeader(headers: Record<string, string | string[] | number | undefined>): string {
  const raw = headers["set-cookie"];
  if (Array.isArray(raw)) return raw.join("\n");
  return raw === undefined ? "" : String(raw);
}

async function createApp() {
  const app = Fastify();
  const repositories = {
    realtime: { listDevices: async () => [], getDevice: async () => null }
  } as unknown as Repositories;
  const metricConfigs = { get: async () => null, set: async () => {} };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, new MetricsService(repositories, () => {}, metricConfigs), {
    metricConfigs,
    fanNotes: { get: async () => ({}), set: async () => {} }
  });
  await app.ready();
  return app;
}

function sessionCookie(app: Awaited<ReturnType<typeof createApp>>, session: object): string {
  const signed = app.signCookie(Buffer.from(JSON.stringify(session)).toString("base64url"));
  return `dsc_session=${encodeURIComponent(signed)}`;
}

test("browser login issues a long-lived HttpOnly cookie", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { accessKey: env.ACCESS_KEY }
  });
  assert.equal(response.statusCode, 200);

  const header = setCookieHeader(response.headers);
  assert.match(header, /dsc_session=/);
  const maxAge = Number(header.match(/Max-Age=(\d+)/)?.[1] ?? 0);
  assert.ok(maxAge >= 90 * 24 * 60 * 60 - 5 && maxAge <= 90 * 24 * 60 * 60, `unexpected Max-Age=${maxAge}`);
  assert.match(header, /HttpOnly/);
});

test("a session near expiry is renewed without changing issuedAt", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const session = createSession(env.ACCESS_KEY, new Date(Date.now() - 50 * DAY_MS));
  const response = await app.inject({
    url: "/api/auth/session",
    headers: { cookie: sessionCookie(app, session) }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().issuedAt, session.issuedAt);
  const maxAge = Number(setCookieHeader(response.headers).match(/Max-Age=(\d+)/)?.[1] ?? 0);
  assert.ok(maxAge > 80 * 24 * 60 * 60, `expected a renewed 90-day cookie, got Max-Age=${maxAge}`);
});

test("a fresh session check does not churn the cookie", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    url: "/api/auth/session",
    headers: { cookie: sessionCookie(app, createSession(env.ACCESS_KEY)) }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["set-cookie"], undefined);
});

test("an expired session is rejected", async (t) => {
  const app = await createApp();
  t.after(async () => app.close());

  const response = await app.inject({
    url: "/api/auth/session",
    headers: { cookie: sessionCookie(app, createSession(env.ACCESS_KEY, new Date(Date.now() - 100 * DAY_MS))) }
  });

  assert.equal(response.statusCode, 401);
});

test("a device group mutation rejects unknown and legacy ids and de-duplicates valid ids", async (t) => {
  const updates: Array<{ deviceIds: string[]; group: string | null }> = [];
  const records = new Map([
    ["host-1", { deviceId: "host-1", name: "Host 1", status: "open" as const, sortOrder: 0, group: null, registeredAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
    ["host-2", { deviceId: "host-2", name: "Host 2", status: "open" as const, sortOrder: 1, group: "旧组", registeredAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]
  ]);
  const repositories = {
    devices: {
      listOpenDevices: async () => [...records.values()],
      getOpenDevice: async (deviceId: string) => records.get(deviceId) ?? null,
      updateDeviceGroup: async (deviceIds: string[], group: string | null) => {
        updates.push({ deviceIds, group });
        for (const id of deviceIds) {
          const record = records.get(id);
          if (record) record.group = group;
        }
      }
    },
    realtime: { listDevices: async () => [], getDevice: async () => null },
  } as unknown as Repositories;
  const metricConfigs = { get: async () => null, set: async () => {} };
  const app = Fastify();
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, new MetricsService(repositories, () => {}, metricConfigs), {
    metricConfigs,
    fanNotes: { get: async () => ({}), set: async () => {} }
  });
  await app.ready();
  t.after(async () => app.close());
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const headers = { cookie: `dsc_session=${encodeURIComponent(signed)}` };

  assert.equal((await app.inject({ method: "PUT", url: "/api/devices/group", headers, payload: { deviceIds: ["host-1"], group: "组" } })).statusCode, 200);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { deviceIds: ["host-1"], group: "组" });

  const duplicate = await app.inject({
    method: "PUT",
    url: "/api/devices/group",
    headers,
    payload: { deviceIds: ["host-1", "host-1", "host-2", "host-2"], group: "  宿主机  " }
  });
  assert.equal(duplicate.statusCode, 200);
  assert.deepEqual(updates.at(-1), { deviceIds: ["host-1", "host-2"], group: "宿主机" });

  const unknown = await app.inject({
    method: "PUT",
    url: "/api/devices/group",
    headers,
    payload: { deviceIds: ["host-1", "missing-device"], group: "幽灵组" }
  });
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(unknown.json(), { error: "device_not_found" });
  assert.equal(updates.length, 2, "unknown ids must not partially mutate the known device");

  const legacy = await app.inject({
    method: "PUT",
    url: "/api/devices/group",
    headers,
    payload: { deviceIds: ["vm:old"], group: "宿主机" }
  });
  assert.equal(legacy.statusCode, 400);
  assert.equal((await app.inject({
    method: "PUT",
    url: "/api/devices/group",
    headers,
    payload: { deviceIds: [], group: null }
  })).statusCode, 400);
});
