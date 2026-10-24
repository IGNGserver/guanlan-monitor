import assert from "node:assert/strict";
import test from "node:test";
import type Redis from "ioredis";
import { createHubContractPayload, HUB_CONTRACT_TIMESTAMP } from "../hub-contract-fixtures.js";
import type { DeviceRealtimeState } from "../types.js";
import { toSummary } from "../utils.js";
import { RedisRealtimeReadModels } from "./realtime-read-models.js";

const epoch = Date.parse(HUB_CONTRACT_TIMESTAMP);
function state(deviceId = "model-node", offset = 0, emptyArrays = false): DeviceRealtimeState {
  const latest = createHubContractPayload({
    deviceId,
    timestamp: epoch + offset,
    metricQuality: {},
    ...(emptyArrays ? { hardware: { cpuPackages: 0, disks: 0, networkInterfaces: 0, gpus: 0, fans: 0, temperatureSensors: 0 } } : {})
  });
  latest.unavailableMetrics = [];
  return { identity: latest.identity, latest, status: "online", lastSeenAt: latest.timestamp };
}

function summary(sample: DeviceRealtimeState) {
  return { ...toSummary(sample), registrationHostname: sample.identity.hostname };
}

type Handler = (...args: unknown[]) => unknown;
function mockRedis(handlers: Record<string, Handler> = {}) {
  const calls: Array<{ command: string; args: unknown[] }> = [];
  const redis = new Proxy({}, {
    get(_target, command: string) {
      return async (...args: unknown[]) => {
        calls.push({ command, args });
        assert.ok(handlers[command], `unexpected Redis command: ${command}`);
        return handlers[command](...args);
      };
    }
  }) as Redis;
  const model = new RedisRealtimeReadModels(redis, "unit-model");
  return { redis, model, calls };
}

test("listSummaries reads only the narrow hash and filters legacy VM rows", async () => {
  const sample = state();
  const { model, calls } = mockRedis({ hvals: () => [sample, state("vm:05c91cad")].map((row) => JSON.stringify(toSummary(row))) });
  assert.deepEqual(await model.listSummaries(), [toSummary(sample)]);
  assert.deepEqual(calls, [{ command: "hvals", args: [model.summaryKey] }]);
});

test("readiness uses PING alone, accepts only PONG and propagates Redis failures", async () => {
  for (const reply of ["PONG", "not-ready"]) {
    const { model, calls } = mockRedis({ ping: () => reply });
    if (reply === "PONG") await model.checkReadiness();
    else await assert.rejects(model.checkReadiness(), /redis_not_ready/);
    assert.deepEqual(calls, [{ command: "ping", args: [] }]);
  }
  const failure = new Error("connection unavailable");
  const { model } = mockRedis({ ping: () => { throw failure; } });
  await assert.rejects(model.checkReadiness(), (error) => error === failure);
});

test("expiry bounds reject invalid cutoffs and limits before any Redis access", async () => {
  const { model, calls } = mockRedis();
  for (const cutoff of [NaN, Infinity, -Infinity]) await assert.rejects(model.listExpiredDevices(cutoff), RangeError);
  for (const limit of [0, -1, 1.5, NaN, Infinity, -Infinity, 1_025, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(model.listExpiredDevices(epoch, limit), RangeError);
  }
  assert.deepEqual(calls, []);
});

test("expiry reads use bounded sorted-set lookup and HMGET, including default and boundary limits", async () => {
  for (const limit of [undefined, 1, 1_024]) {
    const sample = state();
    const { model, calls } = mockRedis({ zrangebyscore: () => [sample.identity.deviceId], hmget: () => [JSON.stringify(sample)] });
    assert.deepEqual(await model.listExpiredDevices(epoch, limit), [sample]);
    assert.deepEqual(calls, [
      { command: "zrangebyscore", args: [model.expiryKey, "-inf", epoch, "LIMIT", 0, limit ?? 128] },
      { command: "hmget", args: [model.deviceKey, sample.identity.deviceId] }
    ]);
  }
});

test("initialization is single-flight, HSCANs every page and marks completion only at the end", async () => {
  let release!: (value: string | null) => void;
  const marker = new Promise<string | null>((resolve) => { release = resolve; });
  const first = state("first");
  const second = { ...state("second", 1_000), status: "offline" as const };
  const raw = JSON.stringify(first);
  const { model, calls } = mockRedis({
    get: () => marker,
    hscan: (_key, cursor) => cursor === "0"
      ? ["17", [first.identity.deviceId, raw, "vm:05c91cad", "not-json"]]
      : ["0", [second.identity.deviceId, JSON.stringify(second)]],
    eval: () => 1,
    set: () => "OK"
  });
  const initialization = model.initialize();
  assert.equal(model.initialize(), initialization);
  assert.deepEqual(calls, [{ command: "get", args: [model.versionKey] }]);
  release(null);
  await Promise.all([initialization, model.initialize()]);
  assert.deepEqual(calls.map((call) => call.command), ["get", "hscan", "eval", "hscan", "eval", "set"]);
  assert.deepEqual(calls.filter((call) => call.command === "hscan").map((call) => call.args), [
    [model.deviceKey, "0", "COUNT", 128], [model.deviceKey, "17", "COUNT", 128]
  ]);
  const writes = calls.filter((call) => call.command === "eval");
  for (const [index, sample] of [first, second].entries()) {
    assert.deepEqual(writes[index].args.slice(1), [3, model.deviceKey, model.summaryKey, model.expiryKey,
      sample.identity.deviceId, JSON.stringify(sample), JSON.stringify(summary(sample)), sample.status, Date.parse(sample.lastSeenAt)]);
    assert.match(writes[index].args[0] as string, /redis\.call\('hget', KEYS\[1\], ARGV\[1\]\) ~= ARGV\[2\]/);
    assert.doesNotMatch(writes[index].args[0] as string, /cjson\.encode/);
  }
  assert.deepEqual(calls.at(-1), { command: "set", args: [model.versionKey, "1"] });
  await model.initialize();
  assert.equal(calls.length, 6, "successful initialization stays cached");
});

test("persisted completion marker skips all migration reads and writes after restart", async () => {
  const { redis, model, calls } = mockRedis({ get: () => "1" });
  await model.initialize();
  await new RedisRealtimeReadModels(redis, "unit-model").initialize();
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({ command: "get", args: [model.versionKey] })));
});

test("failed migration never completes its marker and can be retried after partial writes", async () => {
  let fail = true;
  const sample = state();
  const { model, calls } = mockRedis({
    get: () => null,
    hscan: (_key, cursor) => {
      if (cursor === "0") return ["12", [sample.identity.deviceId, JSON.stringify(sample)]];
      if (fail) throw new Error("scan interrupted");
      return ["0", []];
    },
    eval: () => 1,
    set: () => "OK"
  });
  await assert.rejects(model.initialize(), /scan interrupted/);
  assert.equal(calls.filter((call) => call.command === "set").length, 0);
  fail = false;
  await model.initialize();
  assert.equal(calls.filter((call) => call.command === "get").length, 2);
  assert.equal(calls.filter((call) => call.command === "eval").length, 2);
  assert.deepEqual(calls.at(-1), { command: "set", args: [model.versionKey, "1"] });
});

test("invalid legacy JSON and failed backfill writes do not certify migration", async () => {
  for (const invalidJson of [true, false]) {
    const sample = state();
    const { model, calls } = mockRedis({
      get: () => null,
      hscan: () => ["0", [sample.identity.deviceId, invalidJson ? "not-json" : JSON.stringify(sample)]],
      eval: () => { throw new Error("write failed"); }
    });
    await assert.rejects(model.initialize());
    assert.ok(!calls.some((call) => call.command === "set"));
  }
});

test("upsert sends one atomic three-key Lua write with Node-encoded state and summary", async () => {
  const { model, calls } = mockRedis({ eval: () => 1 });
  for (const status of ["online", "offline"] as const) {
    const sample = { ...state("empty-arrays", 0, true), status };
    await model.upsert(sample);
    const [script, ...args] = calls.at(-1)!.args;
    assert.deepEqual(args, [3, model.deviceKey, model.summaryKey, model.expiryKey,
      sample.identity.deviceId, JSON.stringify(sample), JSON.stringify(summary(sample)), status, epoch]);
    assert.match(script as string, /redis\.call\('hset', KEYS\[1\], ARGV\[1\], ARGV\[2\]\)/);
    assert.match(script as string, /redis\.call\('hset', KEYS\[2\], ARGV\[1\], ARGV\[3\]\)/);
    assert.match(script as string, /redis\.call\('zadd', KEYS\[3\], ARGV\[5\], ARGV\[1\]\)/);
    assert.match(script as string, /redis\.call\('zrem', KEYS\[3\], ARGV\[1\]\)/);
    assert.doesNotMatch(script as string, /cjson\.encode/);
    assert.deepEqual(JSON.parse(args[5] as string).latest.gpus, []);
    assert.deepEqual(JSON.parse(args[6] as string).unavailableMetrics, []);
  }
  assert.equal(calls.length, 2);
});

test("invalid legacy lastSeenAt uses a finite zero score during backfill and upsert", async () => {
  const sample = { ...state(), lastSeenAt: "not-a-date" };
  const { model, calls } = mockRedis({
    get: () => null,
    hscan: () => ["0", [sample.identity.deviceId, JSON.stringify(sample)]],
    eval: () => 1,
    set: () => "OK"
  });
  await model.initialize();
  await model.upsert(sample);
  assert.deepEqual(calls.filter((call) => call.command === "eval").map((call) => call.args.at(-1)), [0, 0]);
});

test("offline CAS compares the expected timestamp and writes Node JSON without re-encoding arrays", async () => {
  for (const result of [0, 1]) {
    const { model, calls } = mockRedis({ eval: () => result });
    const sample = { ...state("offline-arrays", 0, true), status: "offline" as const };
    assert.equal(await model.markOfflineIfMatch(sample.identity.deviceId, sample.lastSeenAt, sample), result === 1);
    assert.equal(calls.length, 1);
    const [script, ...args] = calls[0].args;
    assert.deepEqual(args, [3, model.deviceKey, model.summaryKey, model.expiryKey,
      sample.identity.deviceId, sample.lastSeenAt, JSON.stringify(sample), JSON.stringify(summary(sample))]);
    assert.match(script as string, /state\.lastSeenAt ~= ARGV\[2\]/);
    assert.match(script as string, /redis\.call\('hset', KEYS\[1\], ARGV\[1\], ARGV\[3\]\)/);
    assert.match(script as string, /redis\.call\('hset', KEYS\[2\], ARGV\[1\], ARGV\[4\]\)/);
    assert.match(script as string, /redis\.call\('zrem', KEYS\[3\], ARGV\[1\]\)/);
    assert.doesNotMatch(script as string, /cjson\.encode/);
  }
});

test("remove atomically deletes only the state, summary and expiry member", async () => {
  const { model, calls } = mockRedis({ eval: () => 1 });
  await model.remove("removed-node");
  assert.equal(calls.length, 1);
  const [script, ...args] = calls[0].args;
  assert.deepEqual(args, [3, model.deviceKey, model.summaryKey, model.expiryKey, "removed-node"]);
  assert.match(script as string, /redis\.call\('hdel', KEYS\[1\], ARGV\[1\]\)/);
  assert.match(script as string, /redis\.call\('hdel', KEYS\[2\], ARGV\[1\]\)/);
  assert.match(script as string, /redis\.call\('zrem', KEYS\[3\], ARGV\[1\]\)/);
});

test("missing, offline and legacy-only expiry pages are cleaned before continuing to real expiries", async () => {
  const offline = { ...state("offline"), status: "offline" as const };
  const legacy = state("vm:05c91cad");
  const online = state("online");
  const pages = [["missing"], [offline.identity.deviceId], [legacy.identity.deviceId], [online.identity.deviceId]];
  const rows = [null, JSON.stringify(offline), JSON.stringify(legacy), JSON.stringify(online)];
  let page = 0;
  const { model, calls } = mockRedis({
    zrangebyscore: () => { assert.ok(page < pages.length, "expiry scan must make progress"); return pages[page]; },
    hmget: () => [rows[page++]],
    eval: () => 1
  });
  assert.deepEqual(await model.listExpiredDevices(epoch, 1), [online]);
  const cleanups = calls.filter((call) => call.command === "eval");
  assert.equal(cleanups.length, 3);
  for (let index = 0; index < cleanups.length; index++) {
    const [script, ...args] = cleanups[index].args;
    assert.deepEqual(args, [2, model.deviceKey, model.expiryKey, pages[index][0], rows[index] ?? ""]);
    assert.match(script as string, /redis\.call\('hget', KEYS\[1\], ARGV\[1\]\)/);
    assert.match(script as string, /raw == ARGV\[2\]/);
    assert.match(script as string, /redis\.call\('zrem', KEYS\[2\], ARGV\[1\]\)/);
  }
});

test("a cleaned final expiry page returns an empty list without bulk hash reads", async () => {
  let page = 0;
  const { model, calls } = mockRedis({
    zrangebyscore: () => page++ === 0 ? ["missing"] : [],
    hmget: () => [null],
    eval: () => 1
  });
  assert.deepEqual(await model.listExpiredDevices(epoch, 1), []);
  assert.deepEqual(calls.map((call) => call.command), ["zrangebyscore", "hmget", "eval", "zrangebyscore"]);
});

test("expiry rechecks lastSeenAt when a newer heartbeat lands between index lookup and HMGET", async () => {
  const fresh = state("racing-heartbeat", 10_000, true);
  let page = 0;
  const { model } = mockRedis({
    // The index selected the old state; HMGET observes the newly accepted sample.
    zrangebyscore: () => page++ === 0 ? [fresh.identity.deviceId] : [],
    hmget: () => [JSON.stringify(fresh)]
  });
  const expired = await model.listExpiredDevices(epoch, 1);
  assert.deepEqual(expired.map((sample) => sample.lastSeenAt), [], "a fresh heartbeat must not be offered for offline CAS");
});
