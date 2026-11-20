import bcrypt from "bcryptjs";
import type { z } from "zod";
import type { AppDeps } from "../../deps.js";
import { conflict, notFound, unauthorized } from "../../lib/errors.js";
import { signToken } from "../../middleware/auth.js";
import type { UserRole } from "../../types/enums.js";
import type { LoginBody, RegisterBody } from "./schemas.js";

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  rescue_team_id: string | null;
  password_hash: string | null;
  created_at: Date;
}

const toUser = (r: UserRow) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  role: r.role,
  rescueTeamId: r.rescue_team_id,
  createdAt: r.created_at.toISOString(),
});

// Compared against when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("suraksha-timing-equaliser", 10);

function issue(deps: AppDeps, row: UserRow) {
  const { JWT_SECRET, JWT_EXPIRES_IN_SECONDS } = deps.config;
  const token = signToken({ id: row.id, role: row.role, teamId: row.rescue_team_id }, JWT_SECRET, JWT_EXPIRES_IN_SECONDS);
  return { token, expiresIn: JWT_EXPIRES_IN_SECONDS, user: toUser(row) };
}

export async function register(deps: AppDeps, body: z.infer<typeof RegisterBody>) {
  const hash = await bcrypt.hash(body.password, deps.config.BCRYPT_ROUNDS);
  try {
    const { rows } = await deps.pool.query<UserRow>(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, 'citizen') RETURNING *`,
      [body.name, body.email, body.phone ?? null, hash],
    );
    return issue(deps, rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw conflict("ACCOUNT_EXISTS", "An account with this email or phone already exists");
    throw err;
  }
}

export async function login(deps: AppDeps, body: z.infer<typeof LoginBody>) {
  const { rows } = await deps.pool.query<UserRow>(`SELECT * FROM users WHERE email = $1`, [body.email]);
  const row = rows[0];
  const ok = await bcrypt.compare(body.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !row.password_hash || !ok) throw unauthorized("Invalid email or password");
  return issue(deps, row);
}

export async function me(deps: AppDeps, userId: string) {
  const { rows } = await deps.pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) throw notFound("User");
  return toUser(rows[0]);
}
