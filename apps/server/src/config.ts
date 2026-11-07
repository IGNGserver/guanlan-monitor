import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env" });

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, z.boolean().default(false));

const defaultSessionCookieSecure = process.env.NODE_ENV === "production";
const minimumAccessKeyLength = 6;
const instanceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const schema = z.object({
  SESSION_SECRET: z.string().min(20),
  ACCESS_KEY: z.string().min(minimumAccessKeyLength),
  SESSION_COOKIE_SECURE: z.preprocess(
    (value) => (value === undefined ? defaultSessionCookieSecure : value),
    booleanFromEnv
  ),
  TRUST_PROXY: booleanFromEnv,
  SERVER_HOST: z.string().default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().default(4000),
  AGENT_REQUIRE_HTTPS: booleanFromEnv,
  REDIS_URL: optionalUrl,
  MYSQL_URL: optionalNonEmptyString,
  // bundled keeps the legacy single-host Compose stack; external expects both
  // URLs to point at a shared MySQL/Redis server managed outside this Compose project.
  DSC_DB_MODE: z.enum(["bundled", "external"]).default("bundled"),
  DSC_INSTANCE_ID: z.string().regex(instanceIdPattern, "DSC_INSTANCE_ID must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}").default("default"),
  // Local JSON fallback is only for development. Production must opt in explicitly.
  DSC_ALLOW_LOCAL_FALLBACK: booleanFromEnv,
  DSC_DB_WRITER_LOCK: booleanFromEnv,
  MYSQL_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  MYSQL_QUEUE_LIMIT: z.coerce.number().int().min(0).max(10_000).default(128),
  MYSQL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  MYSQL_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  MYSQL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(5_000),
  // Default 120s tolerates 3 missed 30s agent reports plus collection/network jitter before marking offline.
  DSC_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(15_000).max(86_400_000).default(120_000),
  // Bounded in-process read cache. Zero disables a tier.
  DSC_DEVICE_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(3_000),
  DSC_HISTORY_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(15_000),
  DSC_CALENDAR_CACHE_TTL_MS: z.coerce.number().int().min(0).max(600_000).default(60_000),
  DSC_CACHE_MAX_ENTRIES: z.coerce.number().int().min(1).max(10_000).default(512),
  DSC_CACHE_MAX_BYTES: z.coerce.number().int().min(64 * 1024).max(1024 * 1024 * 1024).default(64 * 1024 * 1024),
  // Optional shared L2 cache. The L1 cache remains active even when Redis is unavailable.
  DSC_REDIS_CACHE_ENABLED: booleanFromEnv,
  DSC_VERSION: optionalNonEmptyString.default("dev"),
  DSC_RELEASE_CHANNEL: z.enum(["stable", "test"]).default("test"),
  DSC_RELEASE_REPOSITORY: z.string().min(1).default("IGNGserver/guanlan-monitor"),
  DSC_RELEASE_API_URL: optionalUrl,
  DSC_IOS_UPDATE_URL: optionalUrl,
  DSC_UPDATE_CACHE_SECONDS: z.coerce.number().int().min(30).default(300),
  CORS_ORIGINS: optionalNonEmptyString,
  DSC_HUB_UPDATE_ENABLED: booleanFromEnv,
  DSC_GITHUB_TOKEN: optionalNonEmptyString,
  DSC_HUB_TEST_UPDATE_WORKFLOW: z.string().min(1).default("deploy-test.yml"),
  DSC_HUB_STABLE_UPDATE_WORKFLOW: z.string().min(1).default("deploy-production.yml"),
  // Deprecated after v0.1.107. ACCESS_KEY is the single credential for all clients.
  AGENT_SHARED_SECRET: optionalNonEmptyString
});

export const env = schema.parse(process.env);

const weakSecretMarkers = ["change-me", "replace-me", "change_me", "replace_me", "example", "default", "password"];
const hasWeakMarker = (value: string) => weakSecretMarkers.some((marker) => value.toLowerCase().includes(marker));
const urlPassword = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.password ? decodeURIComponent(parsed.password) : null;
  } catch {
    return null;
  }
};

/** MySQL URLs must keep credentials, database name and no client-breaking query flags. */
export function parseMysqlUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MYSQL_URL must be a valid mysql:// URL.");
  }
  if (parsed.protocol !== "mysql:") throw new Error("MYSQL_URL must use the mysql:// scheme.");
  if (!parsed.hostname) throw new Error("MYSQL_URL must include a host.");
  if (!parsed.pathname.slice(1)) throw new Error("MYSQL_URL must include a database name.");
  for (const forbidden of ["multipleStatements", "isServer", "stream", "infileStreamFactory", "localAddress"]) {
    if (parsed.searchParams.has(forbidden)) {
      throw new Error(`MYSQL_URL must not set the ${forbidden} option.`);
    }
  }
  return parsed;
}

/** Redis URLs allow both redis:// and rediss://, with an optional database index. */
export function parseRedisUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a valid redis:// or rediss:// URL.");
  }
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use the redis:// or rediss:// scheme.");
  }
  if (!parsed.hostname) throw new Error("REDIS_URL must include a host.");
  return parsed;
}

/** Keep the legacy 'dsc' keys for the default instance and isolate every other instance. */
export function redisNamespaceFor(instanceId: string): string {
  return instanceId === "default" ? "dsc" : `dsc:${instanceId}`;
}

export const redisNamespace = redisNamespaceFor(env.DSC_INSTANCE_ID);

if (env.MYSQL_URL) parseMysqlUrl(env.MYSQL_URL);
if (env.REDIS_URL) parseRedisUrl(env.REDIS_URL);

if (env.DSC_DB_MODE === "external" && (!env.MYSQL_URL || !env.REDIS_URL)) {
  throw new Error("DSC_DB_MODE=external requires both MYSQL_URL and REDIS_URL.");
}
if (env.DSC_DB_MODE === "external" && env.DSC_INSTANCE_ID === "default") {
  throw new Error("DSC_DB_MODE=external requires a unique DSC_INSTANCE_ID other than 'default'.");
}

if (process.env.NODE_ENV === "production") {
  if (env.SESSION_SECRET.length < 32 || hasWeakMarker(env.SESSION_SECRET)) {
    throw new Error("SESSION_SECRET must be a strong, non-placeholder secret in production.");
  }
  const productionAccessKeyMinimum = minimumAccessKeyLength;
  const productionMysqlPasswordMinimum = 6;
  if (env.ACCESS_KEY.length < productionAccessKeyMinimum || hasWeakMarker(env.ACCESS_KEY)) {
    throw new Error(`ACCESS_KEY must be a strong, non-placeholder secret with at least ${productionAccessKeyMinimum} characters.`);
  }
  if (!env.DSC_ALLOW_LOCAL_FALLBACK && (!env.MYSQL_URL || !env.REDIS_URL)) {
    throw new Error("Production requires MYSQL_URL and REDIS_URL; set DSC_ALLOW_LOCAL_FALLBACK=true only for an intentional local-only deployment.");
  }
  const redisPassword = urlPassword(env.REDIS_URL);
  if (env.REDIS_URL && (!redisPassword || redisPassword.length < 16 || hasWeakMarker(redisPassword))) {
    throw new Error("REDIS_URL must contain a strong, non-placeholder password in production.");
  }
  const mysqlPassword = urlPassword(env.MYSQL_URL);
  if (env.MYSQL_URL && (!mysqlPassword || mysqlPassword.length < productionMysqlPasswordMinimum || hasWeakMarker(mysqlPassword))) {
    throw new Error(`MYSQL_URL must contain a non-placeholder password with at least ${productionMysqlPasswordMinimum} characters.`);
  }
}

if (env.AGENT_SHARED_SECRET && env.AGENT_SHARED_SECRET !== env.ACCESS_KEY) {
  console.warn("AGENT_SHARED_SECRET is ignored; ACCESS_KEY is the unified credential for web, clients, and agents.");
}
