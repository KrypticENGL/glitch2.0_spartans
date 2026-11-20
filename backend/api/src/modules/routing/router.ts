import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { UuidParam } from "../../lib/schemas.js";
import { RouteEvaluateBody } from "./schemas.js";
import * as service from "./service.js";

export function routesRouter(deps: AppDeps) {
  const r = Router();
  r.post("/evaluate", async (req, res) => {
    res.json(await service.evaluateRoutes(deps, RouteEvaluateBody.parse(req.body), req.auth?.id ?? null));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getRouteRecord(deps, UuidParam.parse(req.params).id));
  });
  return r;
}
