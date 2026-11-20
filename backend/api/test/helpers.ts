import type { Express } from "express";
import request from "supertest";
import { inject } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { createPool, type Pool } from "../src/db/pool.js";
import type { AppDeps } from "../src/deps.js";
import { createLogger } from "../src/lib/logger.js";
import type { EventType, PublishInput, Publisher } from "../src/realtime/events.js";
import { RoutingEngineError, type RoutingClient } from "../src/services/routing-client.js";

export const DEMO_PASSWORD = "suraksha-demo";

export const testEnv = () => ({
  NODE_ENV: "test",
  DATABASE_URL: inject("databaseUrl"),
  DB_POOL_MAX: "1",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BCRYPT_ROUNDS: "4",
  LOG_LEVEL: "silent",
  RATE_LIMIT_MAX: "100000",
  RATE_LIMIT_AUTH_MAX: "100000",
  RATE_LIMIT_SOS_MAX: "100000",
});

export class RecordingPublisher implements Publisher {
  events: { type: EventType; rooms: string[]; input: PublishInput }[] = [];
  publish(type: EventType, rooms: string[], input: PublishInput) {
    this.events.push({ type, rooms, input });
  }
  ofType(type: EventType) {
    return this.events.filter((e) => e.type === type);
  }
}

export const unavailableRouting: RoutingClient = {
  evaluate: () => Promise.reject(new RoutingEngineError(0, "ENGINE_UNREACHABLE", "down")),
  reload: () => Promise.resolve({}),
  health: () => Promise.reject(new RoutingEngineError(0, "ENGINE_UNREACHABLE", "down")),
};

export interface TestContext {
  app: Express;
  pool: Pool;
  deps: AppDeps;
  events: RecordingPublisher;
}

export function makeTestApp(overrides: Partial<AppDeps> = {}): TestContext {
  const config = loadConfig(testEnv());
  const pool = createPool(config.DATABASE_URL, 1);
  const events = new RecordingPublisher();
  const deps: AppDeps = { config, pool, logger: createLogger("silent"), routing: unavailableRouting, realtime: events, ...overrides };
  return { app: createApp(deps), pool, deps, events };
}

export async function login(app: Express, email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as { token: string }).token;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function teamId(pool: Pool, code: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM rescue_teams WHERE code = $1`, [code]);
  return rows[0]!.id;
}

export const SOS_BODY = {
  location: { latitude: 26.152, longitude: 85.9 },
  emergencyType: "stranded",
  peopleCount: 4,
};
