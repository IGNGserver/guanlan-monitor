import assert from "node:assert/strict";
import test from "node:test";
import { createHubContractPayload } from "../hub-contract-fixtures.js";
import type { DeviceRealtimeState, Repositories, TimeSeriesRecord } from "../types.js";
import { MetricsService } from "./metrics.js";
import { KeyedSerialQueue, QueueCapacityError } from "../serial-queue.js";

function harness(insertMinutePoint: (id: string, point: TimeSeriesRecord) => Promise<void>) {
  const states = new Map<string, DeviceRealtimeState>();
  const registry: string[] = [];
  const service = new MetricsService({
    devices: {
      registerOrUpdateDevice: async () => { registry.push("open"); return { status: "open" }; },
      deleteDevice: async () => { registry.push("closed"); }
    },
    realtime: {
      getDevice: async (id: string) => states.get(id) ?? null,
      upsert: async (state: DeviceRealtimeState) => { states.set(state.identity.deviceId, state); },
      appendSeries: async () => {}, readSeries: async () => [], remove: async (id: string) => { states.delete(id); },
      listDevices: async () => [...states.values()]
    },
    history: { insertMinutePoint, insertHourlyPoint: async () => {} }
  } as unknown as Repositories, () => {}, { get: async () => null, set: async () => {} });
  return { service, states, registry };
}

const nextTurn = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };

test("aggregate ownership survives the former timeout until the database settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void;
  let writes = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { service } = harness(async () => { writes++; await blocked; });
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  await service.ingest(createHubContractPayload({ timestamp: start + 1_000 }));
  let settled = false;
  const rollover = service.ingest(createHubContractPayload({ timestamp: start + 61_000 }))
    .finally(() => { settled = true; });
  await nextTurn();
  assert.equal(writes, 1);
  const flush = service.flushAggregates();
  t.after(async () => { release(); await Promise.allSettled([rollover, flush]); });
  // Observe rejection to avoid an unhandled test rejection on the old code.
  const result = rollover.then(() => null, (error: unknown) => error);
  t.mock.timers.tick(10_001);
  await nextTurn();
  assert.equal(settled, false, "a timeout must not release aggregate ownership");
  assert.equal(writes, 1, "flush cannot overlap the timed-out database write");
  release();
  assert.equal(await result, null);
  await flush;
});

test("concurrent flush callers join the same work instead of claiming early completion", async (t) => {
  let release!: () => void;
  let writes = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { service } = harness(async () => { writes++; await blocked; });
  await service.ingest(createHubContractPayload({ timestamp: Date.now() }));
  const first = service.flushAggregates();
  let secondDone = false;
  const second = service.flushAggregates().then(() => { secondDone = true; });
  t.after(async () => { release(); await Promise.allSettled([first, second]); });
  await nextTurn();
  assert.equal(writes, 1);
  assert.equal(secondDone, false);
  release();
  await Promise.all([first, second]);
  assert.equal(secondDone, true);
});

test("removal waits for already admitted ingest and only later authoritative ingest reopens the device", async (t) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const { service, states, registry } = harness(async () => { await blocked; });
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const deviceId = "synthetic-ordered-removal";
  await service.ingest(createHubContractPayload({ deviceId, timestamp: start + 1_000 }));
  const ingest = service.ingest(createHubContractPayload({ deviceId, timestamp: start + 61_000 }));
  const removal = service.removeDevice(deviceId);
  t.after(async () => { release(); await Promise.allSettled([ingest, removal]); });
  await nextTurn();
  assert.deepEqual(registry, ["open", "open"]);
  release();
  await Promise.all([ingest, removal]);
  assert.deepEqual(registry, ["open", "open", "closed"]);
  assert.equal(states.has(deviceId), false);
  await service.ingest(createHubContractPayload({ deviceId, timestamp: start + 121_000 }));
  assert.equal(states.has(deviceId), true);
  assert.deepEqual(registry, ["open", "open", "closed", "open"]);
});

test("inner admission rejects ingest and removal before registry, realtime or credential side effects", async (t) => {
  const { service, states, registry } = harness(async () => {});
  // Inject a tiny queue to exercise real overload without retaining 1,024 payloads.
  const queue = new KeyedSerialQueue(1, 1);
  (service as unknown as { deviceQueues: KeyedSerialQueue }).deviceQueues = queue;
  let release!: () => void;
  const holding = queue.run("blocked", () => new Promise<void>((resolve) => { release = resolve; }));
  await nextTurn();
  t.after(async () => { release(); await holding; });
  const sample = createHubContractPayload({ timestamp: Date.now() });
  await assert.rejects(service.ingest(sample), QueueCapacityError);
  let revoked = false;
  await assert.rejects(service.removeDevice(sample.identity.deviceId, async () => { revoked = true; }), QueueCapacityError);
  assert.deepEqual(registry, []);
  assert.equal(states.size, 0);
  assert.equal(revoked, false);
  release();
  await holding;
  await service.ingest(sample);
  assert.equal(states.get(sample.identity.deviceId)?.latest.timestamp, sample.timestamp);
});

test("final flush takes a fresh device snapshot after joining an old periodic flush", async (t) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[] = [];
  const { service } = harness(async (id) => { writes.push(id); await blocked; });
  await service.ingest(createHubContractPayload({ deviceId: "first", timestamp: Date.now() }));
  const periodic = service.flushAggregates();
  await nextTurn();
  await service.ingest(createHubContractPayload({ deviceId: "arrived-during-flush", timestamp: Date.now() }));
  const final = service.flushAfterDrain();
  t.after(async () => { release(); await Promise.allSettled([periodic, final]); });
  assert.deepEqual(writes, ["first"]);
  release();
  await Promise.all([periodic, final]);
  assert.ok(writes.includes("arrived-during-flush"));
});
