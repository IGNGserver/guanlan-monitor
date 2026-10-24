import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Redis from "ioredis";
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

function isolatedRedisUrl(raw: string): string {
  const url = new URL(raw);
  assert.equal(url.protocol, "redis:");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Redis fixtures must use a loopback host");
  assert.equal(url.pathname, "/15", "Redis fixtures require the explicit isolated database index /15");
  assert.equal(url.search, "", "query parameters must not override fixture connection settings");
  assert.equal(url.hash, "");
  return url.href;
}

test("read-model Redis URL guard rejects remote hosts and implicit or overridden databases", () => {
  for (const url of ["redis://example.com/15", "redis://192.168.5.17/15", "redis://127.0.0.1",
    "redis://127.0.0.1/0", "redis://127.0.0.1/1", "redis://127.0.0.1/15?db=0",
    "redis://127.0.0.1/15#ignored", "rediss://127.0.0.1/15"]) {
    assert.throws(() => isolatedRedisUrl(url));
  }
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    assert.equal(new URL(isolatedRedisUrl(`redis://${host}/15`)).pathname, "/15");
  }
});

type Fixture = { redis: Redis; model: RedisRealtimeReadModels; namespace: string };
function redisTest(name: string, run: (fixture: Fixture) => Promise<void>) {
  test(`real Redis read models: ${name}`, {
    skip: process.env.REDIS_TEST_URL ? false : "REDIS_TEST_URL is not configured; requires loopback Redis /15",
    concurrency: true
  }, async () => {
    // Validate before connecting; never fall back to application/production Redis.
    const url = isolatedRedisUrl(process.env.REDIS_TEST_URL!);
    const namespace = `hub-model-test-${randomUUID()}`;
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 5_000 });
    const model = new RedisRealtimeReadModels(redis, namespace);
    try {
      await redis.connect();
      await run({ redis, model, namespace });
    } finally {
      try {
        // These are the only keys owned by this case: no FLUSHDB or key scanning.
        if (redis.status === "ready") await redis.del(model.deviceKey, model.summaryKey, model.expiryKey, model.versionKey);
      } finally {
        redis.disconnect();
      }
    }
  });
}

redisTest("old device hash backfills summaries and the online-only expiry index", async ({ redis, model }) => {
  const online = state("old-online");
  const offline = { ...state("old-offline", 1_000), status: "offline" as const };
  const legacy = state("vm:05c91cad");
  for (const sample of [online, offline, legacy]) {
    await redis.hset(model.deviceKey, sample.identity.deviceId, JSON.stringify(sample));
  }
  const rawBefore = await redis.hgetall(model.deviceKey);
  await model.initialize();
  assert.equal(await redis.get(model.versionKey), "1");
  assert.deepEqual(await redis.hgetall(model.deviceKey), rawBefore, "migration must not rewrite authoritative states");
  const summaries = await model.listSummaries();
  assert.deepEqual(summaries.sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
    [online, offline].map(summary).sort((a, b) => a.deviceId.localeCompare(b.deviceId)));
  assert.deepEqual(await redis.zrange(model.expiryKey, 0, -1, "WITHSCORES"), [online.identity.deviceId, String(epoch)]);
  assert.equal(await redis.hexists(model.summaryKey, legacy.identity.deviceId), 0);
});

redisTest("restart honors the durable marker instead of rebuilding projections", async ({ redis, model, namespace }) => {
  const sample = state();
  await redis.hset(model.deviceKey, sample.identity.deviceId, JSON.stringify(sample));
  await model.initialize();
  await redis.hdel(model.summaryKey, sample.identity.deviceId);
  await redis.zrem(model.expiryKey, sample.identity.deviceId);
  const restarted = new RedisRealtimeReadModels(redis, namespace);
  await restarted.initialize();
  assert.deepEqual(await restarted.listSummaries(), []);
  assert.equal(await redis.zcard(model.expiryKey), 0);
  assert.equal(await redis.get(model.versionKey), "1");
});

redisTest("failed migration leaves no marker and a repaired legacy row can be retried", async ({ redis, model }) => {
  const sample = state();
  await redis.hset(model.deviceKey, sample.identity.deviceId, "not-json");
  await assert.rejects(model.initialize());
  assert.equal(await redis.get(model.versionKey), null);
  await redis.hset(model.deviceKey, sample.identity.deviceId, JSON.stringify(sample));
  await model.initialize();
  assert.deepEqual(await model.listSummaries(), [summary(sample)]);
  assert.equal(await redis.get(model.versionKey), "1");
});

redisTest("backfill CAS cannot replace projections written by a heartbeat after the HSCAN observation", async ({ redis, model, namespace }) => {
  const old = state("backfill-cas");
  const fresh = state("backfill-cas", 10_000);
  await redis.hset(model.deviceKey, old.identity.deviceId, JSON.stringify(old));
  const migratingRedis = new Proxy(redis, {
    get(target, property) {
      if (property === "hscan") return async () => {
        const page = await redis.hscan(model.deviceKey, "0", "COUNT", 128);
        assert.equal(page[0], "0", "the single-row fixture fits one scan page");
        await model.upsert(fresh);
        return page;
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  await new RedisRealtimeReadModels(migratingRedis, namespace).initialize();
  assert.equal(await redis.hget(model.deviceKey, fresh.identity.deviceId), JSON.stringify(fresh));
  assert.equal(await redis.hget(model.summaryKey, fresh.identity.deviceId), JSON.stringify(summary(fresh)));
  assert.equal(await redis.zscore(model.expiryKey, fresh.identity.deviceId), String(epoch + 10_000));
  assert.equal(await redis.get(model.versionKey), "1");
});

redisTest("atomic upsert stores exact state bytes, toSummary equality and the matching index score", async ({ redis, model }) => {
  for (const sample of [state("upsert"), state("upsert", 1_000)]) {
    await model.upsert(sample);
    assert.equal(await redis.hget(model.deviceKey, sample.identity.deviceId), JSON.stringify(sample));
    assert.equal(await redis.hget(model.summaryKey, sample.identity.deviceId), JSON.stringify(summary(sample)));
    const [storedSummary] = await model.listSummaries();
    const { registrationHostname, ...publicSummary } = storedSummary;
    assert.deepEqual(publicSummary, toSummary(sample));
    assert.equal(registrationHostname, sample.identity.hostname);
    assert.equal(await redis.zscore(model.expiryKey, sample.identity.deviceId), String(Date.parse(sample.lastSeenAt)));
  }
  const offline = { ...state("upsert", 2_000), status: "offline" as const };
  await model.upsert(offline);
  assert.equal(await redis.hget(model.deviceKey, "upsert"), JSON.stringify(offline));
  assert.deepEqual(await model.listSummaries(), [summary(offline)]);
  assert.equal(await redis.zscore(model.expiryKey, "upsert"), null);
});

redisTest("offline CAS cannot overwrite a new state, summary or expiry index", async ({ redis, model }) => {
  const old = state("cas");
  const fresh = state("cas", 10_000);
  await model.upsert(old);
  await model.upsert(fresh);
  assert.equal(await model.markOfflineIfMatch("cas", old.lastSeenAt, { ...old, status: "offline" }), false);
  assert.equal(await redis.hget(model.deviceKey, "cas"), JSON.stringify(fresh));
  assert.equal(await redis.hget(model.summaryKey, "cas"), JSON.stringify(summary(fresh)));
  assert.equal(await redis.zscore(model.expiryKey, "cas"), String(epoch + 10_000));
  const offline = { ...fresh, status: "offline" as const };
  assert.equal(await model.markOfflineIfMatch("cas", fresh.lastSeenAt, offline), true);
  assert.equal(await redis.hget(model.deviceKey, "cas"), JSON.stringify(offline));
  assert.equal(await redis.hget(model.summaryKey, "cas"), JSON.stringify(summary(offline)));
  assert.equal(await redis.zscore(model.expiryKey, "cas"), null);
  assert.equal(await model.markOfflineIfMatch("missing", old.lastSeenAt, offline), false);
});

redisTest("remove consistently deletes all three projections without touching another device or marker", async ({ redis, model }) => {
  const removed = state("removed");
  const retained = state("retained", 1_000);
  await model.initialize();
  await model.upsert(removed);
  await model.upsert(retained);
  await model.remove(removed.identity.deviceId);
  await model.remove(removed.identity.deviceId);
  assert.equal(await redis.hget(model.deviceKey, removed.identity.deviceId), null);
  assert.equal(await redis.hget(model.summaryKey, removed.identity.deviceId), null);
  assert.equal(await redis.zscore(model.expiryKey, removed.identity.deviceId), null);
  assert.equal(await redis.hget(model.deviceKey, retained.identity.deviceId), JSON.stringify(retained));
  assert.deepEqual(await model.listSummaries(), [summary(retained)]);
  assert.equal(await redis.zscore(model.expiryKey, retained.identity.deviceId), String(epoch + 1_000));
  assert.equal(await redis.get(model.versionKey), "1");
});

redisTest("expiry returns only due online devices in score order and respects its limit", async ({ redis, model }) => {
  const due = [state("first", -1_000), state("boundary")];
  const future = state("future", 1_000);
  const offline = { ...state("offline", -2_000), status: "offline" as const };
  for (const sample of [...due, future, offline]) await model.upsert(sample);
  assert.deepEqual(await model.listExpiredDevices(epoch, 1), [due[0]]);
  assert.deepEqual(await model.listExpiredDevices(epoch, 2), due);
  assert.deepEqual(await model.listExpiredDevices(epoch, 1_024), due);
  assert.deepEqual(await model.listExpiredDevices(epoch - 1_001, 1), []);
});

redisTest("expiry does not return a heartbeat accepted between index selection and hash read", async ({ redis, model, namespace }) => {
  const old = state("expiry-race");
  const fresh = state("expiry-race", 10_000);
  await model.upsert(old);
  const racingRedis = new Proxy(redis, {
    get(target, property) {
      if (property === "zrangebyscore") return async () => {
        const ids = await redis.zrangebyscore(model.expiryKey, "-inf", epoch, "LIMIT", 0, 1);
        if (ids.length) await model.upsert(fresh);
        return ids;
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const expired = await new RedisRealtimeReadModels(racingRedis, namespace).listExpiredDevices(epoch, 1);
  assert.deepEqual(expired.map((sample) => sample.lastSeenAt), []);
  assert.equal(await redis.hget(model.deviceKey, fresh.identity.deviceId), JSON.stringify(fresh));
  assert.equal(await redis.hget(model.summaryKey, fresh.identity.deviceId), JSON.stringify(summary(fresh)));
  assert.equal(await redis.zscore(model.expiryKey, fresh.identity.deviceId), String(epoch + 10_000), "fresh index entries must not be cleaned");
});

redisTest("missing hash fields and stale offline/legacy pages do not starve a due online device", async ({ redis, model }) => {
  const deleted = state("deleted", -4_000);
  const offline = { ...state("offline", -3_000), status: "offline" as const };
  const legacy = state("vm:05c91cad", -2_000);
  const online = state("online", -1_000);
  for (const sample of [deleted, offline, legacy, online]) await model.upsert(sample);
  await redis.hdel(model.deviceKey, deleted.identity.deviceId);
  await redis.zadd(model.expiryKey, epoch - 3_000, offline.identity.deviceId);
  assert.deepEqual(await model.listExpiredDevices(epoch, 1), [online]);
  for (const sample of [deleted, offline, legacy]) assert.equal(await redis.zscore(model.expiryKey, sample.identity.deviceId), null);
  assert.equal(await redis.zscore(model.expiryKey, online.identity.deviceId), String(epoch - 1_000));
  await model.remove(online.identity.deviceId);
  assert.deepEqual(await model.listExpiredDevices(epoch, 1), []);
});

redisTest("empty arrays survive migration, upsert and offline CAS without Lua cjson re-encoding", async ({ redis, model }) => {
  const sample = state("arrays", 0, true);
  await redis.hset(model.deviceKey, sample.identity.deviceId, JSON.stringify(sample));
  await model.initialize();
  assert.deepEqual(await model.listSummaries(), [summary(sample)]);
  await model.upsert(sample);
  assert.deepEqual(await model.listExpiredDevices(epoch), [sample]);
  const offline = { ...sample, status: "offline" as const };
  assert.equal(await model.markOfflineIfMatch(sample.identity.deviceId, sample.lastSeenAt, offline), true);
  const raw = await redis.hget(model.deviceKey, sample.identity.deviceId);
  assert.equal(raw, JSON.stringify(offline));
  const latest = JSON.parse(raw!).latest;
  for (const field of ["cpuPackages", "disks", "networkInterfaces", "gpus", "fans", "temperatureSensors", "unavailableMetrics"]) {
    assert.deepEqual(latest[field], [], field);
  }
  assert.equal(await redis.hget(model.summaryKey, sample.identity.deviceId), JSON.stringify(summary(offline)));
  assert.deepEqual(await model.listSummaries(), [summary(offline)]);
});
