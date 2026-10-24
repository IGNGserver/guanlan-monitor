import type Redis from "ioredis";
import { isLegacyVirtualMachineId } from "../legacy-devices.js";
import { normalizeRealtimeState, toSummary } from "../utils.js";
import type { DeviceRealtimeState, RealtimeDeviceSummary } from "../types.js";

const WRITE_STATE = `
  redis.call('hset', KEYS[1], ARGV[1], ARGV[2])
  redis.call('hset', KEYS[2], ARGV[1], ARGV[3])
  if ARGV[4] == 'online' then
    redis.call('zadd', KEYS[3], ARGV[5], ARGV[1])
  else
    redis.call('zrem', KEYS[3], ARGV[1])
  end
  return 1
`;

const BACKFILL = `
  -- A concurrent accepted sample must win over an old HSCAN observation.
  if redis.call('hget', KEYS[1], ARGV[1]) ~= ARGV[2] then return 0 end
  redis.call('hset', KEYS[2], ARGV[1], ARGV[3])
  if ARGV[4] == 'online' then redis.call('zadd', KEYS[3], ARGV[5], ARGV[1])
  else redis.call('zrem', KEYS[3], ARGV[1]) end
  return 1
`;

const MARK_OFFLINE = `
  local raw = redis.call('hget', KEYS[1], ARGV[1])
  if not raw then return 0 end
  local ok, state = pcall(cjson.decode, raw)
  if not ok or state.lastSeenAt ~= ARGV[2] then return 0 end
  redis.call('hset', KEYS[1], ARGV[1], ARGV[3])
  redis.call('hset', KEYS[2], ARGV[1], ARGV[4])
  redis.call('zrem', KEYS[3], ARGV[1])
  return 1
`;

const REMOVE_STATE = `
  redis.call('hdel', KEYS[1], ARGV[1])
  redis.call('hdel', KEYS[2], ARGV[1])
  redis.call('zrem', KEYS[3], ARGV[1])
  return 1
`;

const REMOVE_MISSING_EXPIRY = `
  local raw = redis.call('hget', KEYS[1], ARGV[1])
  if not raw or (ARGV[2] ~= '' and raw == ARGV[2]) then
    redis.call('zrem', KEYS[2], ARGV[1])
  end
  return 1
`;

/** Narrow durable projections. There is one authoritative Hub writer per store. */
export class RedisRealtimeReadModels {
  readonly deviceKey: string;
  readonly summaryKey: string;
  readonly expiryKey: string;
  readonly versionKey: string;
  private initialization?: Promise<void>;

  // The namespace parameter permits isolated fixtures, never a request-supplied prefix.
  constructor(private readonly redis: Redis, namespace = "dsc") {
    this.deviceKey = `${namespace}:device`;
    this.summaryKey = `${namespace}:device-summary:v1`;
    this.expiryKey = `${namespace}:device-last-seen:v1`;
    this.versionKey = `${namespace}:realtime-model:v1`;
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.backfill().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }
    return this.initialization;
  }

  private async backfill() {
    if (await this.redis.get(this.versionKey) === "1") return;
    let cursor = "0";
    do {
      const [next, entries] = await this.redis.hscan(this.deviceKey, cursor, "COUNT", 128);
      cursor = next;
      for (let index = 0; index < entries.length; index += 2) {
        const [id, raw] = [entries[index], entries[index + 1]];
        if (isLegacyVirtualMachineId(id)) continue;
        const state = normalizeRealtimeState(JSON.parse(raw) as DeviceRealtimeState);
        await this.redis.eval(BACKFILL, 3, this.deviceKey, this.summaryKey, this.expiryKey,
          id, raw, this.summary(state), state.status, this.lastSeen(state));
      }
    } while (cursor !== "0");
    // Interrupted/failed migrations do not set the marker and can be safely retried.
    await this.redis.set(this.versionKey, "1");
  }

  private lastSeen(state: DeviceRealtimeState): number {
    const timestamp = Date.parse(state.lastSeenAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private summary(state: DeviceRealtimeState): string {
    return JSON.stringify({ ...toSummary(state), registrationHostname: state.identity.hostname });
  }

  async upsert(state: DeviceRealtimeState): Promise<void> {
    await this.redis.eval(WRITE_STATE, 3, this.deviceKey, this.summaryKey, this.expiryKey,
      state.identity.deviceId, JSON.stringify(state), this.summary(state), state.status, this.lastSeen(state));
  }

  async markOfflineIfMatch(deviceId: string, expectedLastSeenAt: string, state: DeviceRealtimeState): Promise<boolean> {
    return await this.redis.eval(MARK_OFFLINE, 3, this.deviceKey, this.summaryKey, this.expiryKey,
      deviceId, expectedLastSeenAt, JSON.stringify(state), this.summary(state)) === 1;
  }

  async remove(deviceId: string): Promise<void> {
    await this.redis.eval(REMOVE_STATE, 3, this.deviceKey, this.summaryKey, this.expiryKey, deviceId);
  }

  async listSummaries(): Promise<RealtimeDeviceSummary[]> {
    const rows = await this.redis.hvals(this.summaryKey);
    return rows.map((raw) => JSON.parse(raw) as RealtimeDeviceSummary).filter((row) => !isLegacyVirtualMachineId(row.deviceId));
  }

  async listExpiredDevices(cutoff: number, limit = 128): Promise<DeviceRealtimeState[]> {
    if (!Number.isFinite(cutoff) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1_024) {
      throw new RangeError("invalid expiry scan bounds");
    }
    for (;;) {
      const ids = await this.redis.zrangebyscore(this.expiryKey, "-inf", cutoff, "LIMIT", 0, limit);
      if (!ids.length) return [];
      const rows = await this.redis.hmget(this.deviceKey, ...ids);
      const states: DeviceRealtimeState[] = [];
      for (let index = 0; index < rows.length; index++) {
        const raw = rows[index];
        if (raw === null) {
          await this.redis.eval(REMOVE_MISSING_EXPIRY, 2, this.deviceKey, this.expiryKey, ids[index], "");
        } else {
          const state = normalizeRealtimeState(JSON.parse(raw) as DeviceRealtimeState);
          if (isLegacyVirtualMachineId(state.identity.deviceId) || state.status === "offline") {
            await this.redis.eval(REMOVE_MISSING_EXPIRY, 2, this.deviceKey, this.expiryKey, ids[index], raw);
          } else if (this.lastSeen(state) <= cutoff) states.push(state);
        }
      }
      // Skip cleaned missing/offline-only pages so they cannot starve real expiries.
      if (states.length) return states;
    }
  }

  async checkReadiness(): Promise<void> {
    if (await this.redis.ping() !== "PONG") throw new Error("redis_not_ready");
  }
}
