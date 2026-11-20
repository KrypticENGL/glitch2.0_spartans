import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../deps.js";
import { UuidParam } from "../../lib/schemas.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { IdempotencyKeyHeader, IncidentListQuery, IncidentStatusBody, PriorityOverrideBody, SosCreateBody } from "./schemas.js";
import * as service from "./service.js";

export function sosRouter(deps: AppDeps, sosLimiter: RequestHandler) {
  const r = Router();
  r.post("/", sosLimiter, async (req, res) => {
    const key = IdempotencyKeyHeader.parse(req.header("idempotency-key"));
    const result = await service.createSos(deps, SosCreateBody.parse(req.body), req.auth ?? null, key);
    res.status(result.created ? 201 : 200).json(result.incident);
  });
  r.get("/:id", requireAuth, async (req, res) => {
    res.json(await service.getSosFor(deps, UuidParam.parse(req.params).id, currentUser(req)));
  });
  return r;
}

export function incidentsRouter(deps: AppDeps) {
  const r = Router();
  r.get("/", requireRole("admin", "responder"), async (req, res) => {
    res.json(await service.listIncidents(deps, IncidentListQuery.parse(req.query)));
  });
  r.patch("/:id/status", requireRole("admin"), async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.setIncidentStatus(deps, id, IncidentStatusBody.parse(req.body), currentUser(req).id));
  });
  r.patch("/:id/priority", requireRole("admin"), async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.overridePriority(deps, id, PriorityOverrideBody.parse(req.body), currentUser(req).id));
  });
  r.post("/:id/reevaluate", requireRole("admin"), async (req, res) => {
    res.json(await service.reevaluatePriority(deps, UuidParam.parse(req.params).id, currentUser(req).id));
  });
  return r;
}
