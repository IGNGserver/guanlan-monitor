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

const schema = z.object({
  SESSION_SECRET: z.string().min(20),
  ACCESS_KEY: z.string().min(16),
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

if (process.env.NODE_ENV === "production") {
  if (env.SESSION_SECRET.length < 32 || hasWeakMarker(env.SESSION_SECRET)) {
    throw new Error("SESSION_SECRET must be a strong, non-placeholder secret in production.");
  }
  if (env.ACCESS_KEY.length < 32 || hasWeakMarker(env.ACCESS_KEY)) {
    throw new Error("ACCESS_KEY must be a strong, non-placeholder secret in production.");
  }
  if (!env.SESSION_COOKIE_SECURE) {
    throw new Error("SESSION_COOKIE_SECURE must be true in production.");
  }
  if (!env.AGENT_REQUIRE_HTTPS) {
    throw new Error("AGENT_REQUIRE_HTTPS must be true in production.");
  }
  const redisPassword = urlPassword(env.REDIS_URL);
  if (!env.REDIS_URL || !redisPassword || redisPassword.length < 16 || hasWeakMarker(redisPassword)) {
    throw new Error("REDIS_URL must contain a strong, non-placeholder password in production.");
  }
  const mysqlPassword = urlPassword(env.MYSQL_URL);
  if (!env.MYSQL_URL || !mysqlPassword || mysqlPassword.length < 16 || hasWeakMarker(mysqlPassword)) {
    throw new Error("MYSQL_URL must contain a strong, non-placeholder password in production.");
  }
}

if (env.AGENT_SHARED_SECRET && env.AGENT_SHARED_SECRET !== env.ACCESS_KEY) {
  console.warn("AGENT_SHARED_SECRET is ignored; ACCESS_KEY is the unified credential for web, clients, and agents.");
}
