const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { summarize } = require("./loading-acceptance-report.cjs");
const { createShapedOrigin } = require("./fixtures/shaped-origin.cjs");
const { createFixtureProxy } = require("./fixtures/web-hub.cjs");

test("nearest-rank P75 retains missing/failed samples rather than rewarding failure", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ ok: true, cacheCommittedMs: (i + 1) * 100 }));
  let metric = summarize(samples, ["cacheCommittedMs"]).metrics.cacheCommittedMs;
  assert.equal(metric.p50, 1000); assert.equal(metric.p75, 1500); assert.equal(metric.status, "fail");
  samples[19] = { ok: false, cacheCommittedMs: 0 };
  assert.equal(summarize(samples, ["cacheCommittedMs"]).failed, 1);
  assert.equal(summarize(samples, ["cacheCommittedMs"]).metrics.cacheCommittedMs.status, "incomplete");
  assert.equal(summarize([{ ok: true }], ["summaryCommittedMs"]).metrics.summaryCommittedMs.p75, null);
  assert.equal(summarize([{ ok: true, interactiveMs: 0 }], ["interactiveMs"]).metrics.interactiveMs.status, "incomplete");
});

test("a real HTTP shared origin applies latency and aggregate bandwidth, bypass is explicit", async () => {
  const payload = Buffer.alloc(10000, "x");
  const upstream = http.createServer((_, res) => res.end(payload));
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const shaped = await createShapedOrigin(`http://127.0.0.1:${upstream.address().port}`, { latencyMs: 40, downloadBps: 50000, uploadBps: 50000 });
  try {
    const started = performance.now();
    const bodies = await Promise.all([fetch(shaped.url).then((r) => r.arrayBuffer()), fetch(shaped.url).then((r) => r.arrayBuffer())]);
    assert.ok(performance.now() - started >= 425, "two concurrent 10KB responses share one 50KB/s pipe plus 40ms latency");
    assert.ok(bodies.every((b) => b.byteLength === payload.length));
    shaped.setEnabled(false);
    assert.equal((await (await fetch(shaped.url)).arrayBuffer()).byteLength, payload.length);
  } finally { await shaped.close(); await new Promise((resolve) => upstream.close(resolve)); }
});

test("fixture delay applies only to requested optional paths, records no body or headers", async () => {
  const fixture = await createFixtureProxy("http://127.0.0.1:1");
  const scenario = { devices: [], mutations: [], reads: [], delayPaths: { "/api/overview/metrics": 250 } };
  const id = fixture.register(scenario);
  try {
    const headers = { cookie: `dsc-fixture=${id}` };
    const optional = fetch(fixture.url + "/api/overview/metrics", { headers });
    const summary = await fetch(fixture.url + "/api/instances", { headers });
    assert.equal(summary.status, 200);
    assert.deepEqual(await summary.json(), []);
    assert.ok(scenario.reads.every((r) => Object.keys(r).sort().join() === "at,path"));
    assert.equal((await optional).status, 200);
  } finally { await fixture.close(); }
});
