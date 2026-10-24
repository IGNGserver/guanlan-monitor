import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Redis from "ioredis";
import { createHubContractPayload, HUB_CONTRACT_TIMESTAMP } from "../hub-contract-fixtures.js";
import type { TimeSeriesRecord } from "../types.js";
import { payloadToTimeSeries } from "../utils.js";
import { RedisRealtimeRepository } from "./realtime.js";

const start = Date.parse(HUB_CONTRACT_TIMESTAMP);
function point(offset: number, cpuUsagePercent = 20, emptyArrays = false): TimeSeriesRecord {
  const payload = createHubContractPayload({
    timestamp: start + offset,
    ...(emptyArrays ? { hardware: { cpuPackages: 0, disks: 0, networkInterfaces: 0, gpus: 0, fans: 0, temperatureSensors: 0 } } : {})
  });
  return payloadToTimeSeries({ ...payload, cpuUsagePercent });
}

function stubRepository() {
  const calls: unknown[][] = [];
  const deletedKeys: string[][] = [];
  const repo = new RedisRealtimeRepository({
    async eval(...args: unknown[]) { calls.push(args); return 1; },
    async del(...keys: string[]) { deletedKeys.push(keys); return keys.length; }
  } as unknown as Redis);
  return { repo, calls, deletedKeys };
}

test("appendSeries rejects invalid limits before contacting Redis", async () => {
  const { repo, calls } = stubRepository();
  for (const limit of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 1_000_001]) {
    await assert.rejects(repo.appendSeries("validation", "1m", point(0), limit), /maxPoints/);
  }
  assert.equal(calls.length, 0);
});

test("appendSeries rejects non-finite timestamps before contacting Redis", async () => {
  const { repo, calls } = stubRepository();
  for (const timestamp of [NaN, Infinity, -Infinity]) {
    await assert.rejects(repo.appendSeries("validation", "1m", { ...point(0), timestamp }, 30), /timestamp/);
  }
  assert.equal(calls.length, 0);
});

test("appendSeries passes both isolated keys to EVAL and keeps Node JSON encoding", async () => {
  const { repo, calls } = stubRepository();
  const sample = point(0, 20, true);
  for (const limit of [1, 30, 1_000_000]) {
    await repo.appendSeries("argument-contract", "5m", sample, limit);
    const [, ...args] = calls.at(-1)!;
    assert.deepEqual(args, [2, "dsc:series:argument-contract:5m", "dsc:series-order-v2:argument-contract:5m", sample.timestamp, JSON.stringify(sample), limit]);
  }
});

test("clearSeries deletes only the device's three list and certification keys", async () => {
  const { repo, deletedKeys } = stubRepository();
  await repo.clearSeries("clear-contract");
  assert.deepEqual(deletedKeys, [[
    "dsc:series:clear-contract:1m", "dsc:series:clear-contract:5m", "dsc:series:clear-contract:15m",
    "dsc:series-order-v2:clear-contract:1m", "dsc:series-order-v2:clear-contract:5m", "dsc:series-order-v2:clear-contract:15m"
  ]]);
});

test("appendSeries gates tail fast paths on certification before its sole history scan", async () => {
  const { repo, calls } = stubRepository();
  await repo.appendSeries("script-structure", "1m", point(0), 30);
  const script = calls[0][0] as string;
  const scan = script.indexOf("redis.call('lrange'");
  assert.ok(scan > 0);
  const fast = script.slice(0, scan);
  assert.equal((script.match(/redis\.call\('lindex'/g) ?? []).length, 1);
  assert.equal((script.match(/redis\.call\('lrange'/g) ?? []).length, 1);
  assert.match(fast, /redis\.call\('lindex', KEYS\[1\], -1\)/);
  assert.match(fast, /if not tail then[\s\S]*redis\.call\('set', KEYS\[2\], '1'\)\s+return 1/);
  assert.match(fast, /local order = redis\.call\('get', KEYS\[2\]\)/);
  assert.match(fast, /if order == '1' and tailTime then\s+if targetTime > tailTime then/);
  assert.match(fast, /targetTime > tailTime then\s+redis\.call\('rpush'[^\n]+\n\s+redis\.call\('ltrim'[^\n]+\n\s+return 1/);
  assert.match(fast, /targetTime == tailTime then\s+redis\.call\('lset', KEYS\[1\], -1, ARGV\[2\]\)[\s\S]*return 1/);
  const slow = script.slice(scan);
  assert.match(slow, /local ordered = order ~= '0'/);
  assert.match(slow, /if found < 0 and itemTime == targetTime then/);
  assert.match(slow, /itemTime <= previous/);
  assert.match(slow, /if not tailTime or targetTime <= tailTime then ordered = false end/);
  assert.match(slow, /redis\.call\('set', KEYS\[2\], ordered and '1' or '0'\)/);
  assert.doesNotMatch(slow, /\bbreak\b/, "certification must inspect entries after the first match");
  assert.doesNotMatch(script, /cjson\.encode/);
});

function isolatedRedisUrl(raw: string) {
  const url = new URL(raw);
  assert.equal(url.protocol, "redis:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Redis fixtures must use a loopback host");
  assert.equal(url.pathname, "/15", "Redis fixtures require the explicit isolated database index /15");
  assert.equal(url.search, "", "query parameters must not override the fixture connection settings");
  assert.equal(url.hash, "");
  return url.href;
}

test("Redis fixture URL refuses non-local hosts and implicit or unexpected database indexes", () => {
  for (const url of ["redis://example.com/15", "redis://127.0.0.1", "redis://127.0.0.1/0", "redis://127.0.0.1/1", "redis://127.0.0.1/15?db=0"]) {
    assert.throws(() => isolatedRedisUrl(url));
  }
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    assert.equal(new URL(isolatedRedisUrl(`redis://${host}/15`)).pathname, "/15");
  }
});

type RedisFixture = { redis: Redis; repo: RedisRealtimeRepository; deviceId: string; key: string; orderKey: string };
function redisTest(name: string, run: (fixture: RedisFixture) => Promise<void>) {
  test(`real Redis: ${name}`, { skip: !process.env.REDIS_TEST_URL }, async () => {
    // Validate before connecting. Never use application URLs or mutate shared keys.
    const url = isolatedRedisUrl(process.env.REDIS_TEST_URL!);
    const deviceId = `redis-append-test-${randomUUID()}`;
    const key = `dsc:series:${deviceId}:1m`;
    const orderKey = `dsc:series-order-v2:${deviceId}:1m`;
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5_000 });
    try {
      await redis.connect();
      await run({ redis, repo: new RedisRealtimeRepository(redis), deviceId, key, orderKey });
    } finally {
      try {
        if (redis.status === "ready") await redis.del(key, orderKey);
      } finally {
        redis.disconnect();
      }
    }
  });
}

redisTest("ordered appends keep the existing list key and exact JSON bytes", async ({ redis, repo, deviceId, key, orderKey }) => {
  const points = [point(0), point(1_000), point(2_000)];
  for (const sample of points) await repo.appendSeries(deviceId, "1m", sample, 30);
  assert.equal(await redis.type(key), "list");
  assert.equal(await redis.get(orderKey), "1");
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
  assert.deepEqual(await repo.readSeries(deviceId, "1m"), JSON.parse(JSON.stringify(points)));
});

redisTest("equal-tail replacement does not append a duplicate", async ({ redis, repo, deviceId, key }) => {
  const first = point(0);
  await repo.appendSeries(deviceId, "1m", first, 30);
  await repo.appendSeries(deviceId, "1m", point(1_000), 30);
  const replacement = point(1_000, 95);
  await repo.appendSeries(deviceId, "1m", replacement, 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), [first, replacement].map((sample) => JSON.stringify(sample)));
});

redisTest("middle timestamp replacement retains its original position", async ({ redis, repo, deviceId, key }) => {
  const points = [point(0), point(1_000), point(2_000)];
  for (const sample of points) await repo.appendSeries(deviceId, "1m", sample, 30);
  points[1] = point(1_000, 95);
  await repo.appendSeries(deviceId, "1m", points[1], 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
});

redisTest("legacy unordered lists keep first-match replacement and append ordering", async ({ redis, repo, deviceId, key, orderKey }) => {
  const points = [point(3_000), point(0), point(3_000, 40), point(5_000)];
  await redis.rpush(key, ...points.map((sample) => JSON.stringify(sample)));
  points[0] = point(3_000, 95);
  await repo.appendSeries(deviceId, "1m", points[0], 30);
  const older = point(1_000);
  await repo.appendSeries(deviceId, "1m", older, 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), [...points, older].map((sample) => JSON.stringify(sample)));
  assert.equal(await redis.get(orderKey), "0");
});

redisTest("uncertified [30,10] replaces 30 instead of mistaking it for a fresh append", async ({ redis, repo, deviceId, key, orderKey }) => {
  const original = [point(30_000), point(10_000)];
  await redis.rpush(key, ...original.map((sample) => JSON.stringify(sample)));
  const replacement = point(30_000, 95);
  await repo.appendSeries(deviceId, "1m", replacement, 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), [replacement, original[1]].map((sample) => JSON.stringify(sample)));
  assert.equal(await redis.get(orderKey), "0");
  await repo.appendSeries(deviceId, "1m", point(30_000, 90), 30);
  assert.equal(await redis.llen(key), 2);
  assert.equal((await repo.readSeries(deviceId, "1m"))[0].cpuUsagePercent, 90);
});

redisTest("uncertified [10,30,30] replaces the first match, not the tail", async ({ redis, repo, deviceId, key, orderKey }) => {
  const points = [point(10_000), point(30_000), point(30_000, 40)];
  await redis.rpush(key, ...points.map((sample) => JSON.stringify(sample)));
  points[1] = point(30_000, 95);
  await repo.appendSeries(deviceId, "1m", points[1], 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
  assert.equal(await redis.get(orderKey), "0");
  points[1] = point(30_000, 90);
  await repo.appendSeries(deviceId, "1m", points[1], 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
});

redisTest("legacy strictly ordered lists are certified even when the first point matches", async ({ redis, repo, deviceId, key, orderKey }) => {
  const points = [point(10_000), point(30_000)];
  await redis.rpush(key, ...points.map((sample) => JSON.stringify(sample)));
  points[0] = point(10_000, 95);
  await repo.appendSeries(deviceId, "1m", points[0], 30);
  assert.equal(await redis.get(orderKey), "1");
  points.push(point(40_000));
  await repo.appendSeries(deviceId, "1m", points[2], 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
  assert.equal(await redis.get(orderKey), "1");
});

redisTest("a corrupt interior prevents certification despite a valid increasing tail", async ({ redis, repo, deviceId, key, orderKey }) => {
  const first = point(10_000);
  const last = point(30_000);
  await redis.rpush(key, JSON.stringify(first), "not-json", JSON.stringify(last));
  const replacement = point(10_000, 95);
  await repo.appendSeries(deviceId, "1m", replacement, 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(replacement), "not-json", JSON.stringify(last)]);
  assert.equal(await redis.get(orderKey), "0");
  const newer = point(40_000);
  await repo.appendSeries(deviceId, "1m", newer, 30);
  assert.equal(await redis.get(orderKey), "0");
  assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(replacement), "not-json", JSON.stringify(last), JSON.stringify(newer)]);
});

redisTest("a real old append revokes certification before a later duplicate greater than the tail", async ({ redis, repo, deviceId, key, orderKey }) => {
  await repo.appendSeries(deviceId, "1m", point(30_000), 30);
  assert.equal(await redis.get(orderKey), "1");
  await repo.appendSeries(deviceId, "1m", point(10_000), 30);
  assert.equal(await redis.get(orderKey), "0");
  const replacement = point(30_000, 95);
  await repo.appendSeries(deviceId, "1m", replacement, 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), [replacement, point(10_000)].map((sample) => JSON.stringify(sample)));
});

redisTest("an empty list reinitializes either stale certification value", async ({ redis, repo, deviceId, key, orderKey }) => {
  for (const marker of ["0", "1"]) {
    await redis.del(key);
    await redis.set(orderKey, marker);
    const sample = point(10_000);
    await repo.appendSeries(deviceId, "1m", sample, 30);
    assert.equal(await redis.get(orderKey), "1");
    assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(sample)]);
  }
});

redisTest("clearSeries removes its list and independent certification marker", async ({ redis, repo, deviceId, key, orderKey }) => {
  await repo.appendSeries(deviceId, "1m", point(10_000), 30);
  await repo.clearSeries(deviceId);
  assert.equal(await redis.exists(key, orderKey), 0);
});

redisTest("trim applies after append, tail replacement and fallback replacement", async ({ redis, repo, deviceId, key }) => {
  for (const offset of [0, 1_000, 2_000, 3_000]) await repo.appendSeries(deviceId, "1m", point(offset), 3);
  assert.deepEqual((await repo.readSeries(deviceId, "1m")).map((sample) => sample.timestamp), [1_000, 2_000, 3_000].map((offset) => start + offset));
  const replacement = point(3_000, 95);
  await repo.appendSeries(deviceId, "1m", replacement, 2);
  assert.deepEqual(await redis.lrange(key, 0, -1), [point(2_000), replacement].map((sample) => JSON.stringify(sample)));
  await repo.appendSeries(deviceId, "1m", point(2_000, 90), 1);
  assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(replacement)]);
});

redisTest("corrupt and non-object tails fall back without rewriting existing entries", async ({ redis, repo, deviceId, key, orderKey }) => {
  for (const tail of ["not-json", "null", "42", '"scalar"', "[]", "{}", '{"timestamp":"bad"}', '{"timestamp":1e999}']) {
    await redis.del(key, orderKey);
    const original = point(0);
    await redis.rpush(key, JSON.stringify(original), tail);
    const replacement = point(0, 95);
    await repo.appendSeries(deviceId, "1m", replacement, 30);
    assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(replacement), tail]);
    assert.equal(await redis.get(orderKey), "0");
    const newer = point(1_000);
    await repo.appendSeries(deviceId, "1m", newer, 30);
    assert.deepEqual(await redis.lrange(key, 0, -1), [JSON.stringify(replacement), tail, JSON.stringify(newer)]);
  }
});

redisTest("nested empty and populated arrays survive fast paths and fallback byte-for-byte", async ({ redis, repo, deviceId, key }) => {
  const points = [point(0, 20, true), point(1_000)];
  for (const sample of points) await repo.appendSeries(deviceId, "1m", sample, 30);
  points[1] = point(1_000, 95, true);
  await repo.appendSeries(deviceId, "1m", points[1], 30);
  points[0] = point(0, 90);
  await repo.appendSeries(deviceId, "1m", points[0], 30);
  assert.deepEqual(await redis.lrange(key, 0, -1), points.map((sample) => JSON.stringify(sample)));
  assert.deepEqual(await repo.readSeries(deviceId, "1m"), JSON.parse(JSON.stringify(points)));
});

redisTest("concurrent clients append and replace atomically without lost points", async ({ redis, repo, deviceId, key }) => {
  const peer = redis.duplicate();
  try {
    await peer.connect();
    const other = new RedisRealtimeRepository(peer);
    const points = Array.from({ length: 24 }, (_, i) => point(i * 1_000));
    await Promise.all(points.map((sample, i) => (i % 2 ? repo : other).appendSeries(deviceId, "1m", sample, 100)));
    const stored = await repo.readSeries(deviceId, "1m");
    assert.equal(stored.length, points.length);
    assert.deepEqual(stored.map((sample) => sample.timestamp).sort((a, b) => a - b), points.map((sample) => sample.timestamp));
    // All replacement times are now below the tail, independent of client ordering.
    await repo.appendSeries(deviceId, "1m", point(100_000), 100);
    const replacements = points.map((sample) => ({ ...sample, cpuUsagePercent: 95 }));
    await Promise.all(replacements.map((sample, i) => (i % 2 ? repo : other).appendSeries(deviceId, "1m", sample, 100)));
    const replaced = await repo.readSeries(deviceId, "1m");
    assert.equal(replaced.length, points.length + 1);
    for (const sample of replacements) {
      assert.deepEqual(replaced.find((storedPoint) => storedPoint.timestamp === sample.timestamp), JSON.parse(JSON.stringify(sample)));
    }
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? repo : other).appendSeries(deviceId, "1m", point(100_000, i), 100)));
    assert.equal(await redis.llen(key), points.length + 1);
    assert.equal((await repo.readSeries(deviceId, "1m")).filter((sample) => sample.timestamp === start + 100_000).length, 1);
  } finally {
    peer.disconnect();
  }
});
