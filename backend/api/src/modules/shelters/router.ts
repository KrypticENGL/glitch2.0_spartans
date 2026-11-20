import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { UuidParam } from "../../lib/schemas.js";
import { currentUser, requireAuth, requireRole } from "../../middleware/auth.js";
import { ReservationBody, ShelterListQuery, ShelterPatchBody } from "./schemas.js";
import * as service from "./service.js";

export function sheltersRouter(deps: AppDeps) {
  const r = Router();
  r.get("/", async (req, res) => {
    res.json(await service.listShelters(deps, ShelterListQuery.parse(req.query)));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getShelter(deps, UuidParam.parse(req.params).id));
  });
  r.get("/:id/occupancy", async (req, res) => {
    res.json(await service.getOccupancy(deps, UuidParam.parse(req.params).id));
  });
  r.patch("/:id", requireRole("admin"), async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.json(await service.patchShelter(deps, id, ShelterPatchBody.parse(req.body), currentUser(req).id));
  });
  r.post("/:id/reservations", requireAuth, async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    res.status(201).json(await service.reserve(deps, id, ReservationBody.parse(req.body), currentUser(req).id));
  });
  return r;
}
