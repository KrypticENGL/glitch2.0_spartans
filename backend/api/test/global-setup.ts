// Starts an in-process Postgres 17 + PostGIS (PGlite over the wire protocol) on a random port,
// loads schema + OSM roads + demo scenario via scripts/db.mjs, then seeds demo users/incidents/missions.
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { TestProject } from "vitest/node";
import { createPool } from "../src/db/pool.js";
import { seedDemo } from "../src/db/seed-demo.js";
import { DEFAULT_PRIORITY_CONFIG } from "../src/modules/incidents/priority.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const db = await PGlite.create({ extensions: { postgis } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS postgis;");
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 32 });
  await server.start();
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  // Must be async: the DB server lives in this process, so a blocking exec would deadlock.
  await promisify(execFile)(process.execPath, ["scripts/db.mjs", "reset"], { env: { ...process.env, DATABASE_URL: databaseUrl } });
  const pool = createPool(databaseUrl, 1);
  await seedDemo(pool, { password: "suraksha-demo", bcryptRounds: 4, priority: DEFAULT_PRIORITY_CONFIG });
  await pool.end();

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await server.stop();
    await db.close();
  };
}
