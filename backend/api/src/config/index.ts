import { z } from "zod";
import { resolvePriorityConfig, type PriorityConfig } from "../modules/incidents/priority.js";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),
  ROUTING_ENGINE_URL: z.string().url().default("http://127.0.0.1:8001"),
  ROUTING_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: bool.default(false),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_SOS_MAX: z.coerce.number().int().min(1).default(5),
  RESERVATION_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  PRIORITY_CONFIG_JSON: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema> & { priority: PriorityConfig };

/** Parses and validates configuration; throws with every problem listed so startup fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  try {
    return { ...parsed.data, priority: resolvePriorityConfig(parsed.data.PRIORITY_CONFIG_JSON) };
  } catch (err) {
    throw new Error(`Invalid configuration: PRIORITY_CONFIG_JSON: ${(err as Error).message}`);
  }
}
