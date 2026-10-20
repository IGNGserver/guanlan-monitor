import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerRequestTiming } from "./request-timing.js";

test("Server-Timing includes serialization and preserves existing metrics", async () => {
  const app = Fastify();
  registerRequestTiming(app);
  app.get("/ok", async (_request, reply) => { reply.header("Server-Timing", "database;dur=1.0"); return { ok: true }; });
  app.get("/failed", async (_request, reply) => reply.code(503).send({ error: "unavailable" }));
  try {
    const ok = await app.inject("/ok");
    assert.match(String(ok.headers["server-timing"]), /^database;dur=1\.0, hub;dur=\d+\.\d$/);
    assert.deepEqual(ok.json(), { ok: true });
    const failed = await app.inject("/failed");
    assert.equal(failed.statusCode, 503);
    assert.match(String(failed.headers["server-timing"]), /^hub;dur=\d+\.\d$/);
  } finally { await app.close(); }
});
