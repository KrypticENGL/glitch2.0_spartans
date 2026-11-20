// npm run seed:demo — demo users, incidents and missions (run after `npm run db:reset`). DEV/DEMO ONLY.
import { createPool } from "../db/pool.js";
import { seedDemo } from "../db/seed-demo.js";
import { resolvePriorityConfig } from "../modules/incidents/priority.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.NODE_ENV === "production" && !process.env.SEED_DEMO_PASSWORD) {
  throw new Error("Refusing to seed demo accounts with the default password in production; set SEED_DEMO_PASSWORD");
}
const pool = createPool(url, 1);
try {
  await seedDemo(pool, {
    password: process.env.SEED_DEMO_PASSWORD ?? "suraksha-demo",
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
    priority: resolvePriorityConfig(process.env.PRIORITY_CONFIG_JSON),
    log: (m) => console.log(`seed:demo ${m}`),
  });
} finally {
  await pool.end();
}
