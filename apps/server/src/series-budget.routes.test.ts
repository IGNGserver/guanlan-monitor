import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerRoutes } from "./routes.js";
import { createSession } from "./auth.js";
import { env } from "./config.js";
import { MetricsService } from "./services/metrics.js";
import type { Repositories } from "./types.js";

test("point targets are authenticated, bounded and optional on the actual HTTP routes", async () => {
  const app = Fastify();
  const repositories = { realtime: { listDevices: async () => [], getDevice: async () => null } } as unknown as Repositories;
  const metricConfigs = { get: async () => null, set: async () => {} };
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await registerRoutes(app, repositories, new MetricsService(repositories, () => {}, metricConfigs), {
    metricConfigs, fanNotes: { get: async () => ({}), set: async () => {} }
  });
  await app.ready();
  const signed = app.signCookie(Buffer.from(JSON.stringify(createSession(env.ACCESS_KEY))).toString("base64url"));
  const headers = { cookie: `dsc_session=${encodeURIComponent(signed)}` };
  try {
    assert.equal((await app.inject({ url: "/api/overview/metrics?pointBudget=120" })).statusCode, 401);
    for (const target of ["0", "15", "2001", "NaN", "12.5", ""]) {
      for (const path of ["/api/overview/metrics", "/api/devices/missing/metrics"]) {
        assert.equal((await app.inject({ url: `${path}?pointBudget=${target}`, headers })).statusCode, 400);
      }
    }
    const legacy = await app.inject({ url: "/api/overview/metrics?window=5m", headers });
    assert.equal(legacy.statusCode, 200);
    assert.deepEqual(legacy.json(), { window: "5m", instances: [] });
    const limited = await app.inject({ url: "/api/overview/metrics?window=5m&pointBudget=120", headers });
    assert.equal(limited.statusCode, 200);
    assert.deepEqual(limited.json().sampling, { method: "minmax-v1", targetPoints: 120 });
    assert.equal((await app.inject({ url: "/api/devices/missing/metrics?pointBudget=120", headers })).statusCode, 404);
  } finally { await app.close(); }
});
