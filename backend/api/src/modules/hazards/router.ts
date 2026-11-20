import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { UuidParam } from "../../lib/schemas.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import { HazardCreateBody, HazardListQuery, HazardStatusBody, HazardVerifyBody } from "./schemas.js";
import * as service from "./service.js";

export function hazardsRouter(deps: AppDeps) {
  const r = Router();
  r.post("/", async (req, res) => {
    res.status(201).json(await service.createHazard(deps, HazardCreateBody.parse(req.body), req.auth ?? null));
  });
  r.get("/", async (req, res) => {
    res.json(await service.listHazards(deps, HazardListQuery.parse(req.query), req.auth ?? null));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getHazard(deps, UuidParam.parse(req.params).id, req.auth ?? null));
  });
  r.patch("/:id/verify", requireRole("admin"), async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.verifyHazard(deps, id, HazardVerifyBody.parse(req.body), currentUser(req).id));
  });
  r.patch("/:id/status", requireRole("admin"), async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.setHazardStatus(deps, id, HazardStatusBody.parse(req.body), currentUser(req).id));
  });
  return r;
}
