import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { UuidParam } from "../../lib/schemas.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import { MissionCreateBody, MissionListQuery, MissionStatusBody, TeamListQuery } from "./schemas.js";
import * as service from "./service.js";

const staff = requireRole("admin", "responder");

export function teamsRouter(deps: AppDeps) {
  const r = Router();
  r.get("/", staff, async (req, res) => {
    res.json(await service.listTeams(deps, TeamListQuery.parse(req.query)));
  });
  r.get("/:id", staff, async (req, res) => {
    res.json(await service.getTeam(deps, UuidParam.parse(req.params).id));
  });
  return r;
}

export function missionsRouter(deps: AppDeps) {
  const r = Router();
  r.post("/", requireRole("admin"), async (req, res) => {
    res.status(201).json(await service.createMission(deps, MissionCreateBody.parse(req.body), currentUser(req).id));
  });
  r.get("/", staff, async (req, res) => {
    res.json(await service.listMissions(deps, MissionListQuery.parse(req.query), currentUser(req)));
  });
  r.get("/:id", staff, async (req, res) => {
    res.json(await service.getMission(deps, UuidParam.parse(req.params).id, currentUser(req)));
  });
  r.patch("/:id/status", staff, async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.setMissionStatus(deps, id, MissionStatusBody.parse(req.body), currentUser(req)));
  });
  return r;
}
