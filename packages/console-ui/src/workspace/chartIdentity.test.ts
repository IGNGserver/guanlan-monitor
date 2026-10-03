import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartAnimationsEnabled,
  partsFingerprint,
  seriesFingerprint,
  seriesTimeSpan
} from "./chartIdentity.ts";
import { dateValueOf } from "./sampleTime.ts";

const series = (label: string, points: Array<[string, number]>) => ({
  label,
  points: points.map(([timestamp, value]) => ({ timestamp, value }))
});

test("seriesFingerprint is stable for equal content and changes with the data", () => {
  const a = [series("cpu", [["2026-01-01T00:00:00.000Z", 10], ["2026-01-01T00:00:05.000Z", 20]])];
  const b = [series("cpu", [["2026-01-01T00:00:00.000Z", 10], ["2026-01-01T00:00:05.000Z", 20]])];
  const changedValue = [series("cpu", [["2026-01-01T00:00:00.000Z", 10], ["2026-01-01T00:00:05.000Z", 21]])];
  const changedTime = [series("cpu", [["2026-01-01T00:00:00.000Z", 10], ["2026-01-01T00:00:06.000Z", 20]])];
  const changedLength = [series("cpu", [["2026-01-01T00:00:05.000Z", 20]])];
  const changedLabel = [series("gpu", [["2026-01-01T00:00:00.000Z", 10], ["2026-01-01T00:00:05.000Z", 20]])];
  const changedCount = [...a, series("gpu", [["2026-01-01T00:00:00.000Z", 1]])];

  assert.equal(seriesFingerprint(a), seriesFingerprint(b));
  assert.notEqual(seriesFingerprint(a), seriesFingerprint(changedValue));
  assert.notEqual(seriesFingerprint(a), seriesFingerprint(changedTime));
  assert.notEqual(seriesFingerprint(a), seriesFingerprint(changedLength));
  assert.notEqual(seriesFingerprint(a), seriesFingerprint(changedLabel));
  assert.notEqual(seriesFingerprint(a), seriesFingerprint(changedCount));
});

test("seriesFingerprint handles empty series and empty points", () => {
  assert.equal(seriesFingerprint([]), "0:2166136261");
  assert.equal(seriesFingerprint([series("cpu", [])]), seriesFingerprint([series("cpu", [])]));
});

test("partsFingerprint distinguishes labels and values", () => {
  assert.equal(partsFingerprint([{ label: "已用", value: 1 }, { label: "空闲", value: 2 }]),
    partsFingerprint([{ label: "已用", value: 1 }, { label: "空闲", value: 2 }]));
  assert.notEqual(partsFingerprint([{ label: "已用", value: 1 }]), partsFingerprint([{ label: "已用", value: 2 }]));
  assert.notEqual(partsFingerprint([{ label: "a", value: 1 }]), partsFingerprint([{ label: "b", value: 1 }]));
});

test("seriesTimeSpan finds the range in one pass and reports nothing for invalid data", () => {
  const span = seriesTimeSpan([
    series("a", [["2026-01-01T00:00:00.000Z", 1], ["2026-01-01T02:00:00.000Z", 2]]),
    series("b", [["2026-01-01T01:00:00.000Z", 3]])
  ]);
  assert.ok(span);
  assert.equal(span.min, Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(span.max, Date.parse("2026-01-01T02:00:00.000Z"));
  assert.equal(seriesTimeSpan([series("a", [])]), null);
  assert.equal(seriesTimeSpan([series("a", [["not-a-date", 1]])]), null);
});

test("animations are disabled only under reduced motion", () => {
  assert.equal(chartAnimationsEnabled(false), true);
  assert.equal(chartAnimationsEnabled(true), false);
});

test("dateValueOf caches and stays correct across eviction", () => {
  const iso = "2026-02-03T04:05:06.000Z";
  assert.equal(dateValueOf(iso), Date.parse(iso));
  assert.equal(dateValueOf(iso), Date.parse(iso));
  // Push well past the cache limit to exercise eviction, then verify correctness.
  for (let index = 0; index < 5000; index++) {
    const value = `2026-01-01T00:${String(index % 60).padStart(2, "0")}:00.${String(index % 1000).padStart(3, "0")}Z`;
    dateValueOf(value);
  }
  assert.equal(dateValueOf(iso), Date.parse(iso));
  assert.equal(dateValueOf("nonsense"), Date.parse("nonsense"));
});

test("corrected historical readings invalidate the chart content key", () => {
  const original = [series("cpu", [["2026-01-01T00:00:00Z", 10], ["2026-01-01T00:00:05Z", 12], ["2026-01-01T00:00:10Z", 20]])];
  const corrected = structuredClone(original);
  corrected[0].points[1].value = 12.0001;
  assert.notEqual(seriesFingerprint(original), seriesFingerprint(corrected));
});
