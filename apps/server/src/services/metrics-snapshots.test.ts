import assert from "node:assert/strict";
import test from "node:test";
import { AggregateSnapshots } from "../aggregate-snapshots.js";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import { payloadToTimeSeries } from "../utils.js";
import { averageRecord, MetricsService } from "./metrics.js";
import type { MetricAccumulator, Repositories, TimeSeriesRecord } from "../types.js";

const timestamp = Date.parse("2026-10-24T00:00:00Z");
const point = (index: number) => {
  const payload = createHubContractPayload({ timestamp: timestamp + index * 1000 });
  payload.cpuUsagePercent = index;
  return payloadToTimeSeries(payload);
};

test("snapshot memo calls the exact oracle once per revision and owns all outputs", () => {
  let computations = 0;
  const snapshots = new AggregateSnapshots((samples, time) => { computations++; return averageRecord(samples, time); });
  const accumulator = { bucketStartedAt: timestamp, samples: [point(1), point(2)] };
  const expected = averageRecord(accumulator.samples, timestamp);
  const first = snapshots.read(accumulator);
  first.cpuUsagePercent = 999;
  first.recordedDetails!.fans = [];
  for (let index = 0; index < 20; index++) assert.deepEqual(snapshots.read(accumulator), expected);
  assert.equal(computations, 1);
  accumulator.samples[0] = point(3);
  snapshots.invalidate(accumulator);
  assert.deepEqual(snapshots.read(accumulator), averageRecord(accumulator.samples, timestamp));
  assert.equal(computations, 2);
});

test("service invalidates minute/hour snapshots on append and replacement and shares flush reads safely", async () => {
  const writes: TimeSeriesRecord[] = [];
  const service = new MetricsService({ history: {
    getHistoricalSeries: async () => [],
    insertMinutePoint: async (_id: string, value: TimeSeriesRecord) => { writes.push(structuredClone(value)); value.cpuUsagePercent = 999; },
    insertHourlyPoint: async (_id: string, value: TimeSeriesRecord) => { writes.push(structuredClone(value)); value.cpuUsagePercent = 999; }
  } } as unknown as Repositories, () => {}, { get: async () => null, set: async () => {} });
  const internals = service as unknown as {
    minuteAccumulators: Map<string, MetricAccumulator>;
    hourlyAccumulators: Map<string, MetricAccumulator>;
    addMinuteAggregate(id: string, sample: TimeSeriesRecord): Promise<void>;
    addHourlyAggregate(id: string, sample: TimeSeriesRecord): Promise<void>;
  };
  for (const [window, add, values] of [
    ["1h", internals.addMinuteAggregate.bind(service), internals.minuteAccumulators],
    ["1y", internals.addHourlyAggregate.bind(service), internals.hourlyAccumulators]
  ] as const) {
    for (const sample of [point(1), point(2), { ...point(2), cpuUsagePercent: 44 }]) {
      await add("node", sample);
      const current = values.get("node")!;
      const expected = averageRecord(current.samples, current.bucketStartedAt);
      const result = await service.getSeries("node", window);
      assert.deepEqual(result, [expected]);
      result[0].cpuUsagePercent = 999;
      assert.deepEqual(await service.getSeries("node", window), [expected]);
    }
  }
  await service.flushAggregates();
  assert.equal(writes.length, 2);
  assert.deepEqual(await service.getSeries("node", "1h"), [writes[0]]);
  assert.deepEqual(await service.getSeries("node", "1y"), [writes[1]]);
});
