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
  // Web Push (VAPID). Push is disabled unless all four are set; generate with `npm run vapid:generate`.
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, "must be a base64url P-256 public key").optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/, "must be a base64url P-256 private key").optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "must be a mailto: or https: URL").optional(),
  PUSH_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (32 bytes)").optional(),
  PUSH_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  PUSH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  PUSH_TTL_SECONDS: z.coerce.number().int().min(0).max(2_419_200).default(3600),
  PUSH_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  RATE_LIMIT_ALERT_SEND_MAX: z.coerce.number().int().min(1).default(10),
  // Subscriptions are only accepted for these push-service hosts ("*." = any subdomain), so the server never POSTs to arbitrary URLs.
  PUSH_ENDPOINT_HOSTS: z
    .string()
    .default("fcm.googleapis.com,updates.push.services.mozilla.com,*.push.apple.com,*.notify.windows.com")
    .transform((s) => s.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)),
});

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
  encryptionKey: Buffer;
}

export type Config = z.infer<typeof EnvSchema> & { priority: PriorityConfig; push: PushConfig | null };

/** Parses and validates configuration; throws with every problem listed so startup fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject, PUSH_ENCRYPTION_KEY: encKey } = parsed.data;
  const pushVars = [publicKey, privateKey, subject, encKey];
  if (pushVars.some(Boolean) && !pushVars.every(Boolean)) {
    throw new Error("Invalid configuration: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and PUSH_ENCRYPTION_KEY must be set together");
  }
  const push = publicKey && privateKey && subject && encKey ? { publicKey, privateKey, subject, encryptionKey: Buffer.from(encKey, "hex") } : null;
  try {
    return { ...parsed.data, push, priority: resolvePriorityConfig(parsed.data.PRIORITY_CONFIG_JSON) };
  } catch (err) {
    throw new Error(`Invalid configuration: PRIORITY_CONFIG_JSON: ${(err as Error).message}`);
  }
}
