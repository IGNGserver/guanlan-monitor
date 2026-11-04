import type Redis from "ioredis";
import type { SharedReadCache } from "../repositories/cached-history.js";

/** Shared L2 cache. Keys are already instance-scoped by the history wrapper. */
export class RedisReadCache implements SharedReadCache {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string
  ) {}

  async get(key: string): Promise<string | null> {
    return await this.redis.get(`${this.namespace}:cache:${key}`);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(`${this.namespace}:cache:${key}`, value, "PX", Math.max(1, ttlMs));
  }
}
