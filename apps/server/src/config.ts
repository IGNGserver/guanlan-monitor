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
  AGENT_CONTROL_KEEPALIVE_MS: z.coerce.number().int().min(1000).default(15000),
  REDIS_URL: optionalUrl,
  MYSQL_URL: optionalNonEmptyString,
  // Deprecated after v0.1.107. ACCESS_KEY is the single credential for all clients.
  AGENT_SHARED_SECRET: optionalNonEmptyString
});

export const env = schema.parse(process.env);

if (env.AGENT_SHARED_SECRET && env.AGENT_SHARED_SECRET !== env.ACCESS_KEY) {
  console.warn("AGENT_SHARED_SECRET is ignored; ACCESS_KEY is the unified credential for web, clients, and agents.");
}
