import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

interface PgLikeError extends Error {
  code: string;
  constraint?: string;
}

const isPgError = (e: unknown): e is PgLikeError =>
  e instanceof Error && typeof (e as Partial<PgLikeError>).code === "string" && /^[0-9A-Z]{5}$/.test((e as PgLikeError).code);

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(400, "VALIDATION_ERROR", "Request validation failed", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const { status, type } = (typeof err === "object" && err !== null ? err : {}) as { status?: unknown; type?: unknown };
  if (type === "entity.parse.failed") return new AppError(400, "INVALID_JSON", "Request body is not valid JSON");
  if (type === "entity.too.large") return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  if (isPgError(err)) {
    // Constraint names are safe to expose; raw driver messages are not.
    if (err.code === "23505") return new AppError(409, "CONFLICT", "Resource already exists", { constraint: err.constraint });
    if (err.code === "23514") return new AppError(409, "CONSTRAINT_VIOLATION", "Change violates a data constraint", { constraint: err.constraint });
    if (err.code === "23503") return new AppError(409, "REFERENCE_VIOLATION", "Referenced resource does not exist", { constraint: err.constraint });
    if (err.code === "22P02") return new AppError(400, "INVALID_INPUT", "Invalid input value");
  }
  if (typeof status === "number" && status >= 400 && status < 500) return new AppError(status, "BAD_REQUEST", "Bad request");
  return new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}

export const errorHandler = (logger: Logger) => (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appErr = toAppError(err);
  if (appErr.status >= 500) (req.log ?? logger).error({ err }, "request failed");
  res.status(appErr.status).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      ...(appErr.details !== undefined && { details: appErr.details }),
      requestId: req.id === undefined ? undefined : String(req.id),
    },
  });
};

export const notFoundHandler = (_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: "No such endpoint" } });
};
