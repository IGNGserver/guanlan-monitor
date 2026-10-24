import assert from "node:assert/strict";
import test from "node:test";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import type { DeviceRealtimeState, Repositories, TimeSeriesRecord } from "../types.js";
import { MetricsService } from "./metrics.js";

function fixture() {
  const states = new Map<string, DeviceRealtimeState>();
  const minute: TimeSeriesRecord[] = [], hour: TimeSeriesRecord[] = [];
  let failMinute = false, failHour = false, failRedis = false, failRaw = false, failPublish = false;
  const service = new MetricsService({
    devices: { registerOrUpdateDevice: async () => ({ status: "open" }) },
    realtime: {
      getDevice: async (id: string) => states.get(id) ?? null,
      upsert: async (state: DeviceRealtimeState) => {
        if (failPublish) throw new Error("synthetic publication failure");
        states.set(state.identity.deviceId, state);
      },
      appendSeries: async (_id: string, bucket: string) => {
        if (bucket === "15m" && failRedis || bucket === "1m" && failRaw) throw new Error("synthetic Redis failure");
      }
    },
    history: {
      insertMinutePoint: async (_id: string, point: TimeSeriesRecord) => {
        if (failMinute) throw new Error("synthetic minute failure");
        minute.push(structuredClone(point));
      },
      insertHourlyPoint: async (_id: string, point: TimeSeriesRecord) => {
        if (failHour) throw new Error("synthetic hour failure");
        hour.push(structuredClone(point));
      }
    }
  } as unknown as Repositories, () => {}, { get: async () => null, set: async () => {} });
  const at = (timestamp: number, cpuUsagePercent = 40) => ({ ...createHubContractPayload({ timestamp }), cpuUsagePercent });
  return { service, states, minute, hour, at, failure: (kind: "minute" | "hour" | "redis" | "raw" | "publish", value: boolean) => {
    if (kind === "minute") failMinute = value;
    else if (kind === "hour") failHour = value;
    else if (kind === "redis") failRedis = value;
    else if (kind === "raw") failRaw = value;
    else failPublish = value;
  } };
}

const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;

test("unchanged or replayed buckets perform no repeated persistence", async () => {
  const { service, minute, hour, at } = fixture();
  await service.ingest(at(start + 1_000));
  await service.flushAggregates();
  for (let index = 0; index < 10; index++) await service.flushAggregates();
  await service.ingest(at(start + 1_000));
  await service.flushAggregates();
  assert.equal(minute.length, 1);
  assert.equal(hour.length, 1);
});

test("a fresh sample marks both buckets dirty and retains exact cumulative averages", async () => {
  const { service, minute, hour, at } = fixture();
  await service.ingest(at(start + 1_000, 20));
  await service.flushAggregates();
  await service.ingest(at(start + 2_000, 60));
  await service.flushAggregates();
  assert.deepEqual(minute.map((point) => [point.cpuUsagePercent, point.sampleCount]), [[20, 1], [40, 2]]);
  assert.deepEqual(hour.map((point) => [point.cpuUsagePercent, point.sampleCount]), [[20, 1], [40, 2]]);
});

for (const kind of ["minute", "hour", "redis"] as const) {
  test(`a ${kind} write failure stays dirty and retries without resubmitting a successful partner`, async () => {
    const { service, minute, hour, at, failure } = fixture();
    await service.ingest(at(start + 1_000));
    failure(kind, true);
    await assert.rejects(service.flushAggregates(), AggregateError);
    failure(kind, false);
    await service.flushAggregates();
    assert.equal(minute.length, kind === "redis" ? 2 : 1);
    assert.equal(hour.length, 1);
    const count = minute.length;
    await service.flushAggregates();
    assert.equal(minute.length, count);
    assert.equal(hour.length, 1);
  });
}

test("rollover never resubmits a bucket that was successfully flushed unchanged", async () => {
  const { service, minute, hour, at } = fixture();
  await service.ingest(at(start + 1_000));
  await service.flushAggregates();
  await service.ingest(at(start + 3_601_000));
  assert.equal(minute.length, 1);
  assert.equal(hour.length, 1);
  await service.flushAggregates();
  assert.deepEqual(minute.map((point) => point.timestamp), [start, start + 3_600_000]);
  assert.deepEqual(hour.map((point) => point.timestamp), [start, start + 3_600_000]);
});

for (const kind of ["minute", "hour", "raw", "publish"] as const) {
  test(`retry after an ingest ${kind} failure cannot be silently skipped as already accepted`, async () => {
    const { service, states, minute, hour, at, failure } = fixture();
    const first = at(start + 1_000, 20), next = at(start + 3_601_000, 60);
    await service.ingest(first);
    failure(kind, true);
    await assert.rejects(service.ingest(next));
    assert.equal(states.get(first.identity.deviceId)?.latest.timestamp, first.timestamp);
    failure(kind, false);
    await service.ingest(next);
    assert.equal(states.get(first.identity.deviceId)?.latest.timestamp, next.timestamp);
    await service.flushAggregates();
    assert.equal(minute.at(-1)?.timestamp, start + 3_600_000);
    assert.equal(minute.at(-1)?.sampleCount, 1);
    assert.equal(hour.at(-1)?.timestamp, start + 3_600_000);
    assert.equal(hour.at(-1)?.sampleCount, 1);
  });
}
