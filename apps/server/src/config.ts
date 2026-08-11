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

const schema = z.object({
  SESSION_SECRET: z.string().min(8),
  ACCESS_KEY: z.string().min(1),
  SESSION_COOKIE_SECURE: booleanFromEnv,
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
  DSC_HUB_UPDATE_ENABLED: booleanFromEnv,
  DSC_GITHUB_TOKEN: optionalNonEmptyString,
  DSC_HUB_TEST_UPDATE_WORKFLOW: z.string().min(1).default("deploy-test.yml"),
  DSC_HUB_STABLE_UPDATE_WORKFLOW: z.string().min(1).default("deploy-production.yml"),
  // Deprecated after v0.1.107. ACCESS_KEY is the single credential for all clients.
  AGENT_SHARED_SECRET: optionalNonEmptyString
});

export const env = schema.parse(process.env);

if (env.AGENT_SHARED_SECRET && env.AGENT_SHARED_SECRET !== env.ACCESS_KEY) {
  console.warn("AGENT_SHARED_SECRET is ignored; ACCESS_KEY is the unified credential for web, clients, and agents.");
}
