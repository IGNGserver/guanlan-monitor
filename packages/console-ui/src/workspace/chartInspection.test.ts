import assert from "node:assert/strict";
import test from "node:test";
import { chartGestureDirection, chartTimeAtClientX, indexChartSamples, inspectChartTime, latestChartValues, nearestChartTime } from "./chartInspection.ts";

const time = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
const point = (seconds: number, value: number) => ({ timestamp: time(seconds), value });
const series = [
  { label: "下载", points: [point(10, 12), point(0, 4), point(5, 8)], valueFormatter: (value: number) => `${value} MB/s` },
  { label: "上传", points: [point(10, 3), point(0, 1)], valueFormatter: (value: number) => `${value} KB/s` },
  { label: "未采集", points: [] }
];

test("inspection aligns curves by timestamp and leaves missing readings empty", () => {
  const index = indexChartSamples(series);
  const inspected = inspectChartTime(series, index, Date.parse(time(5)));
  assert.deepEqual(inspected.values.map((item) => item.valueText), ["8 MB/s", "—", "—"]);
  assert.equal(inspected.values[1].point, null);
  assert.deepEqual(inspectChartTime(series, index, Date.parse(time(10))).values.map((item) => item.valueText), ["12 MB/s", "3 KB/s", "—"]);
});

test("nearest sample uses the complete sorted timeline and clamps at its ends", () => {
  const index = indexChartSamples([...series, { label: "其他", points: [point(2, 0), point(5, 6), { timestamp: "invalid", value: 2 }, point(12, NaN)] }]);
  assert.deepEqual(index.timeline, [0, 2, 5, 10].map((seconds) => Date.parse(time(seconds))));
  assert.equal(nearestChartTime(index.timeline, Date.parse(time(2))), Date.parse(time(2)));
  assert.equal(nearestChartTime(index.timeline, Date.parse(time(-10))), index.timeline[0]);
  assert.equal(nearestChartTime(index.timeline, Date.parse(time(20))), index.timeline.at(-1));
  assert.equal(nearestChartTime([0, 10], 5), 0);
  assert.equal(nearestChartTime([], 5), null);
  assert.equal(nearestChartTime(index.timeline, NaN), null);
});

test("latest readings recover each curve's actual last valid sample", () => {
  const source = [...series, { label: "失效", points: [point(20, Infinity)] }];
  const latest = latestChartValues(source, indexChartSamples(source));
  assert.equal(latest?.timestamp, Date.parse(time(10)));
  assert.deepEqual(latest?.values.map((item) => item.valueText), ["12 MB/s", "3 KB/s", "—", "—"]);
  assert.equal(latestChartValues([], indexChartSamples([])), null);
});

test("pointer coordinates follow the SVG scale after resizing or zooming", () => {
  assert.equal(chartTimeAtClientX(125, { left: 25, width: 200 }, 400, 60, 20, 1000, 2000), 1437.5);
  assert.equal(chartTimeAtClientX(10, { left: 25, width: 200 }, 400, 60, 20, 1000, 2000), 1000);
  assert.equal(chartTimeAtClientX(999, { left: 25, width: 200 }, 400, 60, 20, 1000, 2000), 2000);
});

test("touch direction locks for the whole gesture so vertical releases cannot inspect", () => {
  assert.equal(chartGestureDirection("pending", 3, 4), "pending");
  assert.equal(chartGestureDirection("pending", 10, 2), "horizontal");
  assert.equal(chartGestureDirection("pending", 2, 10), "vertical");
  assert.equal(chartGestureDirection("vertical", 100, 12), "vertical");
  assert.equal(chartGestureDirection("horizontal", 10, 100), "horizontal");
});
