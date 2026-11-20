import { z } from "../../lib/zod.js";
import { USER_ROLES } from "../../types/enums.js";

const Email = z.email().max(254).transform((e) => e.toLowerCase());

export const RegisterBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: Email,
    password: z.string().min(8).max(128),
    phone: z.string().regex(/^\+?[0-9 -]{7,20}$/).optional(),
  })
  .strict()
  .openapi("RegisterRequest");

export const LoginBody = z.object({ email: Email, password: z.string().min(1).max(128) }).strict().openapi("LoginRequest");

export const User = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    role: z.enum(USER_ROLES),
    rescueTeamId: z.uuid().nullable(),
    createdAt: z.string(),
  })
  .openapi("User");

export const AuthResponse = z.object({ token: z.string(), expiresIn: z.number().int(), user: User }).openapi("AuthResponse");
