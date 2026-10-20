import assert from "node:assert/strict";
import test from "node:test";
import { budgetPoints, budgetSeries } from "./series-budget.js";

const points = (count = 1200) => Array.from({ length: count }, (_, i) => ({ timestamp: new Date(1700000000000 + i * 1000).toISOString(), value: i % 20 }));

test("point targets preserve endpoints, bucket extrema, source timestamps and source data", () => {
  const input = points();
  input[517].value = 1000; input[678].value = -100;
  const before = JSON.stringify(input);
  const result = budgetPoints(input, 120);
  assert.ok(result.length <= 120 && result.length < input.length);
  assert.equal(result[0], input[0]); assert.equal(result.at(-1), input.at(-1));
  assert.ok(result.includes(input[517])); assert.ok(result.includes(input[678]));
  assert.ok(result.every((point) => input.includes(point)));
  assert.equal(JSON.stringify(input), before);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < Buffer.byteLength(before) / 5);
});

test("real gaps, invalid values and unordered/duplicate times stay unmodified", () => {
  const gap = points(); gap.splice(200, 100);
  assert.equal(budgetPoints(gap, 120), gap);
  const duplicate = points(); duplicate[7] = duplicate[6];
  assert.equal(budgetPoints(duplicate, 120), duplicate);
  const invalid = points(); invalid[7].value = NaN;
  assert.equal(budgetPoints(invalid, 120), invalid);
});

test("sampling never invents the median-times-three gaps used by existing clients", () => {
  for (let seed = 0; seed < 20; seed++) {
    const input = points();
    input.forEach((point, i) => { point.value = Math.sin(i * (seed + 1) / 7); });
    const result = budgetPoints(input, 120);
    const gaps = result.slice(1).map((point, i) => Date.parse(point.timestamp) - Date.parse(result[i].timestamp));
    const ordered = [...gaps].sort((a, b) => a - b);
    assert.ok(gaps.every((gap) => gap <= ordered[Math.floor(ordered.length / 2)] * 3));
  }
});

test("legacy requests, counter totals and paired network rates remain exact, including nested instances", () => {
  const input = { cpuUsagePercent: points(), trafficRxBytes: points(), networkRxBytesPerSec: points(), networks: [{ id: "n", rxBytesPerSec: points(), trafficTxBytes: points() }], cpus: [{ id: "cpu", usagePercent: points() }] };
  assert.equal(budgetSeries(input), input);
  const result = budgetSeries(input, 120);
  assert.equal(result.trafficRxBytes, input.trafficRxBytes);
  assert.equal(result.networkRxBytesPerSec, input.networkRxBytesPerSec);
  assert.equal(result.networks[0].rxBytesPerSec, input.networks[0].rxBytesPerSec);
  assert.equal(result.networks[0].trafficTxBytes, input.networks[0].trafficTxBytes);
  assert.ok(result.cpus[0].usagePercent.length <= 120);
});

test("hardware partners keep one shared mask so sums and means remain true at every retained instant", () => {
  const a = points(), b = points();
  b.forEach((point, index) => { point.value = 100 - a[index].value; });
  const input = { cpus: [{ usagePercent: a }, { usagePercent: b }] };
  const result = budgetSeries(input, 120);
  const left = result.cpus[0].usagePercent, right = result.cpus[1].usagePercent;
  assert.ok(left.length < a.length);
  assert.deepEqual(left.map((point) => point.timestamp), right.map((point) => point.timestamp));
  for (let i = 0; i < left.length; i++) {
    const source = a.findIndex((point) => point.timestamp === left[i].timestamp);
    assert.equal(left[i].value + right[i].value, a[source].value + b[source].value);
  }
  const mismatched = { cpus: [{ usagePercent: a }, { usagePercent: b.slice(1) }] };
  assert.equal(budgetSeries(mismatched, 120), mismatched);
});
