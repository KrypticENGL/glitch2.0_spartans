import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import * as service from "./service.js";

export function dashboardRouter(deps: AppDeps) {
  const r = Router();
  r.use(requireRole("admin", "responder"));
  r.get("/summary", async (_req, res) => {
    res.json(await service.summary(deps));
  });
  r.get("/incidents", async (_req, res) => {
    res.json(await service.incidents(deps));
  });
  r.get("/shelters", async (_req, res) => {
    res.json(await service.shelters(deps));
  });
  r.get("/operations", async (req, res) => {
    res.json(await service.operations(deps, currentUser(req)));
  });
  return r;
}
