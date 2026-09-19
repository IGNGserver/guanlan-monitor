import Redis from "ioredis";
import type { MetricWindow } from "@dsc/shared";
import type { DeviceRealtimeState, RealtimeRepository, TimeSeriesRecord } from "../types.js";

const DEVICE_KEY = "dsc:device";
const SERIES_KEY = "dsc:series";

export class RedisRealtimeRepository implements RealtimeRepository {
  constructor(private readonly redis: Redis) {}

  async upsert(state: DeviceRealtimeState) {
    await this.redis.hset(DEVICE_KEY, state.identity.deviceId, JSON.stringify(state));
  }

  async markOfflineIfMatch(deviceId: string, expectedLastSeenAt: string): Promise<boolean> {
    const script = `
      local raw = redis.call('hget', KEYS[1], ARGV[1])
      if not raw then return 0 end
      local state = cjson.decode(raw)
      if state.lastSeenAt == ARGV[2] then
        state.status = 'offline'
        redis.call('hset', KEYS[1], ARGV[1], cjson.encode(state))
        return 1
      end
      return 0
    `;
    const result = await this.redis.eval(script, 1, DEVICE_KEY, deviceId, expectedLastSeenAt);
    return result === 1;
  }

  async getDevice(deviceId: string) {
    const raw = await this.redis.hget(DEVICE_KEY, deviceId);
    return raw ? (JSON.parse(raw) as DeviceRealtimeState) : null;
  }

  async listDevices() {
    const raw = await this.redis.hvals(DEVICE_KEY);
    return raw.map((item) => JSON.parse(item) as DeviceRealtimeState);
  }

  async remove(deviceId: string) {
    await this.redis.hdel(DEVICE_KEY, deviceId);
    await this.clearSeries(deviceId);
  }

  async appendSeries(deviceId: string, bucket: MetricWindow, point: TimeSeriesRecord, maxPoints: number) {
    const key = `${SERIES_KEY}:${deviceId}:${bucket}`;
    const pointJson = JSON.stringify(point);
    const script = `
      local list = redis.call('lrange', KEYS[1], 0, -1)
      local targetTime = tonumber(ARGV[1])
      local found = -1
      for i, item in ipairs(list) do
        local ok, decoded = pcall(cjson.decode, item)
        if ok and decoded.timestamp == targetTime then
          found = i - 1
          break
        end
      end
      if found >= 0 then
        redis.call('lset', KEYS[1], found, ARGV[2])
      else
        redis.call('rpush', KEYS[1], ARGV[2])
      end
      local maxP = tonumber(ARGV[3])
      redis.call('ltrim', KEYS[1], -maxP, -1)
      return 1
    `;
    await this.redis.eval(script, 1, key, point.timestamp, pointJson, maxPoints);
  }

  async readSeries(deviceId: string, bucket: MetricWindow) {
    const key = `${SERIES_KEY}:${deviceId}:${bucket}`;
    const raw = await this.redis.lrange(key, 0, -1);
    return raw.map((item) => JSON.parse(item) as TimeSeriesRecord);
  }

  async clearSeries(deviceId: string) {
    await this.redis.del(`${SERIES_KEY}:${deviceId}:1m`, `${SERIES_KEY}:${deviceId}:5m`, `${SERIES_KEY}:${deviceId}:15m`);
  }
}
