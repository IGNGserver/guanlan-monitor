import assert from "node:assert/strict";
import test from "node:test";
import { generateBatch } from "./generate.mjs";
import { transform, canonicalSha256 } from "./language.mjs";

test("repository fixture: dedup, five-metric golden values, unknown JSON and deterministic replay", async () => {
  const batch = await generateBatch(8);
  const result = JSON.parse(transform(Buffer.from(JSON.stringify(batch))));
  assert.equal(result.records.length, 8);
  assert.equal(result.summary.length, 4);
  assert.deepEqual(result.summary[0], { deviceId: "prototype-00", sampleCount: 2, metrics: {
    cpuUsagePercent: 51.5, memoryUsagePercent: 50, diskUsagePercent: 25, networkRxBytesPerSec: 6144, networkTxBytesPerSec: 3072
  } });
  assert.deepEqual(result.records[0], JSON.parse(JSON.stringify(batch.at(-1))));
  assert.equal(result.records[0].identity.prototypeUnknown, "preserve me");
  assert.equal(result.records[0].prototypeUnknown.nested.at(-1), Number.MAX_SAFE_INTEGER);
  assert.equal(canonicalSha256(result), canonicalSha256(JSON.parse(transform(JSON.stringify(batch)))));
  assert.equal(canonicalSha256(result), "0ff22bb64f46b2bf2ba13880af0db85daa0cccfd682edf34c7c6c4d33c415caf");
  assert.equal(canonicalSha256({ b: 1.25, a: 1e-7 }), canonicalSha256({ a: 0.0000001, b: 1.250 }));
  assert.equal(canonicalSha256(-0), canonicalSha256(0));
});

test("invalid batches, dates and unsafe numbers are rejected rather than silently rounded", async () => {
  assert.throws(() => transform("{}"));
  assert.throws(() => transform("not json"));
  const batch = await generateBatch(1);
  batch[0].prototypeUnknown.big = 2 ** 53;
  assert.throws(() => transform(JSON.stringify(batch)), /safe-number/);
  delete batch[0].prototypeUnknown.big;
  batch[0].timestamp = "2026-02-30T00:00:00.000Z";
  assert.throws(() => transform(JSON.stringify(batch)), /timestamp/);
  assert.deepEqual(JSON.parse(transform("[]")), { records: [], summary: [] });
});
