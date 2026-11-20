// Local stand-in for PostgreSQL+PostGIS when Docker is unavailable: real Postgres 17 + PostGIS 3.6 (PGlite/WASM)
// served over the Postgres wire protocol. Queries from all connections are serialised through one session,
// so it is for development/tests only — use docker-compose (postgis/postgis) for anything else.
// Usage: node devdb/server.mjs [--port 54329] [--memory]
import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const port = Number(arg("--port", process.env.DEVDB_PORT ?? 54329));
const dataDir = process.argv.includes("--memory") ? undefined : new URL("./data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const db = await PGlite.create({ dataDir, extensions: { postgis } });
await db.exec("CREATE EXTENSION IF NOT EXISTS postgis;");
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 32 });
await server.start();
console.log(`devdb ready postgres://postgres:postgres@127.0.0.1:${port}/postgres (${dataDir ?? "in-memory"})`);
const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
