import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../deps.js";
import { currentUser, requireAuth } from "../../middleware/auth.js";
import { LoginBody, RegisterBody } from "./schemas.js";
import * as service from "./service.js";

export function authRouter(deps: AppDeps, authLimiter: RequestHandler) {
  const r = Router();
  r.post("/register", authLimiter, async (req, res) => {
    res.status(201).json(await service.register(deps, RegisterBody.parse(req.body)));
  });
  r.post("/login", authLimiter, async (req, res) => {
    res.json(await service.login(deps, LoginBody.parse(req.body)));
  });
  r.get("/me", requireAuth, async (req, res) => {
    res.json(await service.me(deps, currentUser(req).id));
  });
  return r;
}
