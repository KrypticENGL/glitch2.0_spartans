import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { forbidden, unauthorized } from "../lib/errors.js";
import { USER_ROLES, type UserRole } from "../types/enums.js";

export interface AuthUser {
  id: string;
  role: UserRole;
  teamId: string | null;
}

export function signToken(user: AuthUser, secret: string, expiresInSeconds: number): string {
  return jwt.sign({ role: user.role, teamId: user.teamId }, secret, { algorithm: "HS256", expiresIn: expiresInSeconds, subject: user.id });
}

/** Returns the authenticated user or throws 401. Only HS256 is accepted (prevents algorithm confusion). */
export function verifyToken(token: string, secret: string): AuthUser {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  } catch {
    throw unauthorized("Invalid or expired token");
  }
  const role: unknown = typeof payload === "string" ? undefined : payload.role;
  if (typeof payload === "string" || typeof payload.sub !== "string" || !USER_ROLES.some((r) => r === role)) {
    throw unauthorized("Invalid or expired token");
  }
  return { id: payload.sub, role: role as UserRole, teamId: typeof payload.teamId === "string" ? payload.teamId : null };
}

/** Attaches req.auth when a Bearer token is present. A present-but-invalid token is rejected, never silently ignored. */
export const authenticate = (secret: string) => (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header) return next();
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(unauthorized("Malformed Authorization header"));
  req.auth = verifyToken(token, secret);
  next();
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  next(req.auth ? undefined : unauthorized());
};

export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    next(roles.includes(req.auth.role) ? undefined : forbidden());
  };

/** For handlers mounted behind requireAuth/requireRole. */
export function currentUser(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
