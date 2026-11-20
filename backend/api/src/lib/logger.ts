import { pino, type Logger } from "pino";

export type { Logger };

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.passwordHash",
  "*.phone",
  "*.contactPhone",
  "*.token",
];

export function createLogger(level: string): Logger {
  return pino({ level, redact: { paths: REDACT_PATHS, censor: "[redacted]" } });
}
