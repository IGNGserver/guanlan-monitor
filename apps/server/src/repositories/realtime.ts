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

  async getDevice(deviceId: string) {
    const raw = await this.redis.hget(DEVICE_KEY, deviceId);
    return raw ? (JSON.parse(raw) as DeviceRealtimeState) : null;
  }

  async listDevices() {
    const raw = await this.redis.hvals(DEVICE_KEY);
    return raw.map((item) => JSON.parse(item) as DeviceRealtimeState);
  }

  async appendSeries(deviceId: string, bucket: MetricWindow, point: TimeSeriesRecord, maxPoints: number) {
    const key = `${SERIES_KEY}:${deviceId}:${bucket}`;
    await this.redis.rpush(key, JSON.stringify(point));
    await this.redis.ltrim(key, -maxPoints, -1);
  }

  async readSeries(deviceId: string, bucket: MetricWindow) {
    const key = `${SERIES_KEY}:${deviceId}:${bucket}`;
    const raw = await this.redis.lrange(key, 0, -1);
    return raw.map((item) => JSON.parse(item) as TimeSeriesRecord);
  }

  async clearSeries(deviceId: string) {
    await this.redis.del(`${SERIES_KEY}:${deviceId}:1m`, `${SERIES_KEY}:${deviceId}:15m`);
  }
}
