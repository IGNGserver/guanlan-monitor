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
  SERVER_PORT: z.coerce.number().default(4000),
  REDIS_URL: optionalUrl,
  MYSQL_URL: optionalNonEmptyString,
  AGENT_SHARED_SECRET: z.string().min(16)
});

export const env = schema.parse(process.env);
