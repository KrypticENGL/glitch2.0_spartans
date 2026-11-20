import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import { RoadIdParam, RoadListQuery, RoadStatusBody } from "./schemas.js";
import * as service from "./service.js";

export function roadsRouter(deps: AppDeps) {
  const r = Router();
  r.get("/", async (req, res) => {
    res.json(await service.listRoads(deps, RoadListQuery.parse(req.query)));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getRoad(deps, RoadIdParam.parse(req.params).id));
  });
  r.patch("/:id/status", requireRole("admin"), async (req, res) => {
    const { id } = RoadIdParam.parse(req.params);
    res.json(await service.setRoadStatus(deps, id, RoadStatusBody.parse(req.body), currentUser(req).id));
  });
  return r;
}
