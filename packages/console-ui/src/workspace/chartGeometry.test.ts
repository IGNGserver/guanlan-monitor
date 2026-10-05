import assert from "node:assert/strict";
import test from "node:test";
import { formatsBytes, gapThreshold, monotonePath, niceLinearAxis, niceTimeAxis, silentSpans, splitAtGaps, typicalInterval } from "./chartGeometry.ts";

const MINUTE = 60_000;

test("an outage splits a curve instead of being drawn through", () => {
  const times = [0, 5, 10, 15, 20, 300, 305, 310].map((s) => s * 1000);
  assert.equal(typicalInterval(times), 5000);
  const runs = splitAtGaps(times, (t) => t, gapThreshold(times));
  assert.deepEqual(runs.map((run) => run.length), [5, 3], "a 280 s silence in 5 s samples is an outage");
  assert.deepEqual(silentSpans(times, gapThreshold(times)), [[20_000, 300_000]]);
});

test("jitter and a single late sample are not outages", () => {
  const times = [0, 5, 11, 15, 24, 30].map((s) => s * 1000);
  assert.equal(splitAtGaps(times, (t) => t, gapThreshold(times)).length, 1);
});

test("too few samples to know the cadence never split", () => {
  assert.equal(gapThreshold([1000]), Number.POSITIVE_INFINITY);
  assert.deepEqual(splitAtGaps([1000], (t) => t, gapThreshold([1000])), [[1000]]);
});

/** Every control point's y, from an SVG path built of M/L/C commands. */
function pathYs(path: string): number[] {
  return [...path.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((match) => Number(match[0])).filter((_, index) => index % 2 === 1);
}

test("the curve never overshoots a plateau or dips below a trough", () => {
  // SVG y grows downward: y=10 is the 100 % ceiling, y=200 the zero line.
  const points = [{ x: 0, y: 200 }, { x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 200 }, { x: 50, y: 200 }];
  const ys = pathYs(monotonePath(points));
  assert.ok(Math.min(...ys) >= 10 - 1e-9, `control points rose above the 100 % plateau: ${Math.min(...ys)}`);
  assert.ok(Math.max(...ys) <= 200 + 1e-9, `control points fell below zero: ${Math.max(...ys)}`);
});

test("two points are a straight segment and one point is a move", () => {
  assert.equal(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 5 }]), "M0 0L10 5");
  assert.equal(monotonePath([{ x: 3, y: 4 }]), "M3 4");
  assert.equal(monotonePath([]), "");
});

test("value ticks are round numbers", () => {
  assert.deepEqual(niceLinearAxis([0, 37], { tickCount: 4 }).ticks, [0, 10, 20, 30, 40]);
  assert.deepEqual(niceLinearAxis([12, 88], { pinnedMax: 100, tickCount: 4 }).ticks, [0, 25, 50, 75, 100]);
  const axis = niceLinearAxis([0, 0.37], { tickCount: 4 });
  assert.ok(axis.ticks.every((tick) => Math.abs(tick * 10 - Math.round(tick * 10)) < 1e-9), JSON.stringify(axis.ticks));
});

test("byte axes step in binary units", () => {
  const gib = 1024 ** 3;
  const axis = niceLinearAxis([0, 2.6 * gib], { binary: true, tickCount: 4 });
  assert.equal(axis.ticks[1], 1024 ** 3, "the step is 1 GiB, not 0.65 GiB");
  assert.equal(axis.max, 3 * gib);
});

test("an empty or flat series still yields a usable axis", () => {
  assert.deepEqual(niceLinearAxis([]).ticks.slice(0, 2), [0, 0.25]);
  assert.ok(niceLinearAxis([5, 5]).max >= 5);
});

test("time ticks land on round clock times in local time", () => {
  const start = Date.UTC(2026, 9, 4, 10, 3, 17);
  const axis = niceTimeAxis(start, start + 60 * MINUTE, 4, 0);
  assert.equal(axis.step, 15 * MINUTE);
  assert.deepEqual(axis.ticks.map((tick) => new Date(tick).getUTCMinutes()), [15, 30, 45, 0]);
  // UTC+8 (offset -480): six-hour ticks fall on local 00/06/12/18, not UTC ones.
  const day = niceTimeAxis(Date.UTC(2026, 9, 4, 0, 0), Date.UTC(2026, 9, 5, 0, 0), 5, -480);
  assert.equal(day.step, 6 * 60 * MINUTE);
  assert.ok(day.ticks.every((tick) => (new Date(tick).getUTCHours() + 8) % 6 === 0), JSON.stringify(day.ticks.map((t) => new Date(t).toISOString())));
});

test("byte formatters are recognised for binary steps", () => {
  assert.equal(formatsBytes((value) => `${(value / 1024).toFixed(1)} KB`), true);
  assert.equal(formatsBytes((value) => `${value.toFixed(0)}%`), false);
  assert.equal(formatsBytes(undefined), false);
});
