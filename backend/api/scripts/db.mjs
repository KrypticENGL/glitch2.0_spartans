// Applies SQL migrations (database/migrations) and seeds (database/seeds) in filename order.
// Each file runs in its own transaction and is recorded, so re-running is safe.
// Usage: node scripts/db.mjs migrate|seed|reset   (DATABASE_URL required)
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const cmd = process.argv[2];
const root = new URL("../../database/", import.meta.url);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: url });
await client.connect();

async function apply(kind) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, kind text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = new URL(`${kind}/`, root);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const f of files) {
    const name = `${kind}/${f}`;
    if (done.has(name)) continue;
    const sql = readFileSync(new URL(f, dir), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, kind) VALUES ($1, $2)", [name, kind]);
      await client.query("COMMIT");
      console.log(`applied ${name}`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`${name} failed: ${e.message}`);
    }
  }
}

try {
  if (cmd === "reset") {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await apply("migrations");
    await apply("seeds");
  } else if (cmd === "migrate") await apply("migrations");
  else if (cmd === "seed") await apply("seeds");
  else throw new Error("usage: db.mjs migrate|seed|reset");
} finally {
  await client.end();
}
