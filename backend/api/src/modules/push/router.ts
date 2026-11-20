import { Router } from "express";
import type { AppDeps } from "../../deps.js";
import { PreferencesPatch, SubscribeBody } from "./schemas.js";
import * as service from "./service.js";

export function pushRouter(deps: AppDeps) {
  const r = Router();
  r.get("/config", (_req, res) => {
    res.json(service.pushConfig(deps));
  });
  r.post("/subscribe", async (req, res) => {
    const result = await service.subscribe(deps, SubscribeBody.parse(req.body), req);
    res.status(result.created ? 201 : 200).json({ subscription: result.subscription, manageToken: result.manageToken });
  });
  r.post("/unsubscribe", async (req, res) => {
    res.json(await service.unsubscribe(deps, req));
  });
  r.get("/preferences", async (req, res) => {
    res.json(await service.getPreferences(deps, req));
  });
  r.patch("/preferences", async (req, res) => {
    res.json(await service.updatePreferences(deps, req, PreferencesPatch.parse(req.body)));
  });
  return r;
}
