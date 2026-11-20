import { Router } from "express";
import type { AppDeps } from "../../deps.js";

export function healthRouter(deps: AppDeps) {
  const r = Router();
  r.get("/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  r.get("/ready", async (_req, res) => {
    const [db, engine] = await Promise.allSettled([
      deps.pool.query<{ version: number }>("SELECT version FROM graph_state"),
      deps.routing.health(1500),
    ]);
    const database = db.status === "fulfilled" ? { status: "ok", graphVersion: db.value.rows[0]?.version ?? null } : { status: "unavailable" };
    const routingEngine =
      engine.status === "fulfilled"
        ? { status: engine.value.status === "ok" ? "ok" : "degraded", graphVersion: engine.value.graphVersion ?? null }
        : { status: "unavailable" };
    // Only the database gates readiness; without the engine the API still serves everything except route evaluation.
    res.status(database.status === "ok" ? 200 : 503).json({ status: database.status === "ok" ? "ready" : "not_ready", database, routingEngine });
  });
  return r;
}
