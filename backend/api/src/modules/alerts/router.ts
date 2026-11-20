import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../deps.js";
import { badRequest } from "../../lib/errors.js";
import { UuidParam } from "../../lib/schemas.js";
import { currentUser, requireRole } from "../../middleware/auth.js";
import { IdempotencyKeyHeader } from "../incidents/schemas.js";
import { AlertCreateBody, AlertListQuery, AlertSendBody } from "./schemas.js";
import * as service from "./service.js";

export function alertsRouter(deps: AppDeps) {
  const r = Router();
  r.get("/", async (req, res) => {
    res.json(await service.listPublished(deps, AlertListQuery.parse(req.query)));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getPublished(deps, UuidParam.parse(req.params).id));
  });
  return r;
}

export function adminAlertsRouter(deps: AppDeps, sendLimiter: RequestHandler) {
  const r = Router();
  r.use(requireRole("admin"));
  r.get("/", async (_req, res) => {
    res.json(await service.listAdminAlerts(deps));
  });
  r.post("/", async (req, res) => {
    res.status(201).json(await service.createAlert(deps, AlertCreateBody.parse(req.body), currentUser(req).id));
  });
  r.get("/:id", async (req, res) => {
    res.json(await service.getDraft(deps, UuidParam.parse(req.params).id));
  });
  r.post("/:id/send", sendLimiter, async (req, res) => {
    const { id } = UuidParam.parse(req.params);
    AlertSendBody.parse(req.body);
    const key = IdempotencyKeyHeader.parse(req.header("idempotency-key"));
    if (!key) throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Send requires an Idempotency-Key header");
    const result = await service.sendAlert(deps, id, key, currentUser(req).id);
    res.status(result.replay ? 200 : 202).json(result);
  });
  r.get("/:id/delivery", async (req, res) => {
    res.json(await service.deliveryReport(deps, UuidParam.parse(req.params).id));
  });
  return r;
}
