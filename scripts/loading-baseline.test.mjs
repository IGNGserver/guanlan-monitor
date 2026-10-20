import assert from "node:assert/strict";
import test from "node:test";
import { baselineOrigin, parseMeasurement, summarize } from "./loading-baseline.mjs";

test("baseline forbids URLs carrying credentials or query data", () => {
  assert.equal(baselineOrigin("https://hub.example/"), "https://hub.example");
  for (const value of ["https://user:secret@hub.example", "https://hub.example/?key=private", "https://hub.example/api", "https://hub.example/#private", "file:///etc/passwd"]) {
    assert.throws(() => baselineOrigin(value));
  }
});

test("reports whitelist timings and final public headers, never cookies or bodies", () => {
  const sample = parseMeasurement('HTTP/1.1 200 Connection established\r\nCache-Control: proxy\r\n\r\nHTTP/2 200\r\nServer-Timing: hub;dur=2.0\r\nSet-Cookie: private-session\r\n\r\n\n__GUANLAN_MEASUREMENT__{"http_code":200,"time_starttransfer":0.3,"url_effective":"private","certs":"private"}');
  assert.deepEqual(sample.headers, { "server-timing": "hub;dur=2.0" });
  assert.ok(!JSON.stringify(sample).includes("private"));
  assert.equal(sample.time_starttransfer, 0.3);
  assert.deepEqual(parseMeasurement("incomplete", 28), { exitCode: 28, error: "measurement_unavailable" });
});

test("failed and non-200 requests cannot improve successful percentiles", () => {
  const samples = [1, 2, 3, 4].map((n) => ({ exitCode: 0, http_code: 200, time_starttransfer: n / 10 }));
  samples.push({ exitCode: 0, http_code: 403, time_starttransfer: 0.001 }, { exitCode: 28, http_code: 200, time_starttransfer: 0.001 });
  assert.deepEqual(summarize(samples), { sampleCount: 6, successCount: 4, ttfbP50Ms: 200, ttfbP75Ms: 300 });
  assert.equal(summarize([]).ttfbP50Ms, null);
});
