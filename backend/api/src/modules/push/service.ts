import type { Request } from "express";
import type { AppDeps } from "../../deps.js";
import { withTransaction } from "../../db/pool.js";
import { AppError, notFound, unprocessable } from "../../lib/errors.js";
import { newToken, open, sameHash, seal, sha256 } from "../../lib/secretbox.js";
import type { z } from "../../lib/zod.js";
import type { PushTarget } from "../../services/push-sender.js";
import { ALERT_AREAS } from "../alerts/areas.js";
import type { PreferencesPatch, SubscribeBody } from "./schemas.js";
import { PushHeaders } from "./schemas.js";

const notConfigured = () => new AppError(503, "PUSH_NOT_CONFIGURED", "Push notifications are not configured on this server");

function pushKey(deps: AppDeps): Buffer {
  if (!deps.config.push || !deps.push) throw notConfigured();
  return deps.config.push.encryptionKey;
}

interface SubRow {
  id: string;
  user_id: string | null;
  manage_token_hash: string;
  selected_areas: string[];
  notification_preferences: { minSeverity?: string };
  audience: "demo" | "verified";
  created_at: Date;
  updated_at: Date;
  last_success_at: Date | null;
}

const COLS = `id, user_id, manage_token_hash, selected_areas, notification_preferences, audience, created_at, updated_at, last_success_at`;

const view = (r: SubRow) => ({
  id: r.id,
  selectedAreas: r.selected_areas,
  preferences: { minSeverity: (r.notification_preferences.minSeverity ?? "advisory") as "advisory" | "warning" | "severe" },
  audience: r.audience,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  lastSuccessAt: r.last_success_at?.toISOString() ?? null,
});

export function pushConfig(deps: AppDeps) {
  const enabled = Boolean(deps.config.push && deps.push);
  return { enabled, vapidPublicKey: enabled ? deps.config.push!.publicKey : null, areas: ALERT_AREAS };
}

/** Only known push services (and plain http in tests, for the local receiver) — the server never POSTs to arbitrary URLs. */
export function checkEndpoint(endpoint: string, allowedHosts: string[], allowHttp: boolean) {
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase();
  const hostOk = allowedHosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
  if (!(url.protocol === "https:" || (allowHttp && url.protocol === "http:")) || !hostOk || url.username || url.password) {
    throw unprocessable("PUSH_ENDPOINT_NOT_ALLOWED", "Subscription endpoint is not a supported push service");
  }
}

/** Idempotent per endpoint: re-subscribing the same browser updates the existing row and rotates the manage token. */
export async function subscribe(deps: AppDeps, body: z.infer<typeof SubscribeBody>, req: Request) {
  const key = pushKey(deps);
  checkEndpoint(body.subscription.endpoint, deps.config.PUSH_ENDPOINT_HOSTS, deps.config.NODE_ENV === "test");
  const endpointHash = sha256(body.subscription.endpoint);
  const token = newToken();
  const prefs = body.preferences ?? { minSeverity: "advisory" };
  const userId = req.auth?.id ?? null;
  const previous = PushHeaders.safeParse(req.headers);

  return withTransaction(deps.pool, async (db) => {
    // Renewal: the browser replaced its subscription; retire the old row if the caller proves ownership.
    if (previous.success) {
      const old = await ownedRow(db, previous.data["x-push-subscription-id"], previous.data["x-push-token"], userId);
      if (old) await db.query(`UPDATE push_subscriptions SET invalidated_at = now(), invalidated_reason = 'renewed' WHERE id = $1 AND endpoint_hash <> $2`, [old.id, endpointHash]);
    }
    const values = [
      seal(key, body.subscription.endpoint),
      seal(key, body.subscription.keys.p256dh),
      seal(key, body.subscription.keys.auth),
      sha256(token),
      body.selectedAreas,
      JSON.stringify(prefs),
      userId,
      endpointHash,
    ];
    const updated = await db.query<SubRow>(
      `UPDATE push_subscriptions SET endpoint_enc = $1, p256dh_enc = $2, auth_enc = $3, manage_token_hash = $4, selected_areas = $5,
         notification_preferences = $6, user_id = COALESCE($7, user_id), updated_at = now()
       WHERE endpoint_hash = $8 AND invalidated_at IS NULL RETURNING ${COLS}`,
      values,
    );
    if (updated.rows[0]) return { created: false, subscription: view(updated.rows[0]), manageToken: token };
    const inserted = await db.query<SubRow>(
      `INSERT INTO push_subscriptions (endpoint_enc, p256dh_enc, auth_enc, manage_token_hash, selected_areas, notification_preferences, user_id, endpoint_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
      values,
    );
    return { created: true, subscription: view(inserted.rows[0]!), manageToken: token };
  });
}

async function ownedRow(db: Pick<AppDeps["pool"], "query">, id: string, token: string | undefined, userId: string | null) {
  const { rows } = await db.query<SubRow>(`SELECT ${COLS} FROM push_subscriptions WHERE id = $1 AND invalidated_at IS NULL`, [id]);
  const row = rows[0];
  if (!row) return null;
  if (userId && row.user_id === userId) return row;
  return token && sameHash(row.manage_token_hash, sha256(token)) ? row : null;
}

/** 404 for both "missing" and "not yours", so ids cannot be probed. */
async function requireOwned(deps: AppDeps, req: Request) {
  const h = PushHeaders.parse(req.headers);
  const row = await ownedRow(deps.pool, h["x-push-subscription-id"], h["x-push-token"], req.auth?.id ?? null);
  if (!row) throw notFound("Push subscription");
  return row;
}

export async function unsubscribe(deps: AppDeps, req: Request) {
  const row = await requireOwned(deps, req);
  await deps.pool.query(`UPDATE push_subscriptions SET invalidated_at = now(), invalidated_reason = 'unsubscribed' WHERE id = $1 AND invalidated_at IS NULL`, [row.id]);
  return { id: row.id, unsubscribed: true };
}

export async function getPreferences(deps: AppDeps, req: Request) {
  return view(await requireOwned(deps, req));
}

export async function updatePreferences(deps: AppDeps, req: Request, patch: z.infer<typeof PreferencesPatch>) {
  const row = await requireOwned(deps, req);
  const { rows } = await deps.pool.query<SubRow>(
    `UPDATE push_subscriptions SET selected_areas = COALESCE($2, selected_areas), notification_preferences = COALESCE($3, notification_preferences), updated_at = now()
     WHERE id = $1 RETURNING ${COLS}`,
    [row.id, patch.selectedAreas ?? null, patch.preferences ? JSON.stringify(patch.preferences) : null],
  );
  return view(rows[0]!);
}

const SEVERITY_ORDER = ["advisory", "warning", "severe", "critical"] as const;

/** SQL fragment + params selecting active subscriptions an alert reaches. */
export function eligibilityFilter(audience: "demo" | "verified", areas: string[] | null, severity: (typeof SEVERITY_ORDER)[number]) {
  // A subscriber with minSeverity m receives severities ranked >= m; critical is never filtered.
  const allowedMins = SEVERITY_ORDER.slice(0, SEVERITY_ORDER.indexOf(severity) + 1);
  return {
    where: `invalidated_at IS NULL AND audience = $1 AND ($2::text[] IS NULL OR selected_areas && $2::text[])
            AND COALESCE(notification_preferences->>'minSeverity', 'advisory') = ANY($3::text[])`,
    params: [audience, areas, allowedMins] as unknown[],
  };
}

export async function countEligible(deps: AppDeps, ...args: Parameters<typeof eligibilityFilter>) {
  const f = eligibilityFilter(...args);
  const { rows } = await deps.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM push_subscriptions WHERE ${f.where}`, f.params);
  return rows[0]!.n;
}

export async function loadTargets(deps: AppDeps, ...args: Parameters<typeof eligibilityFilter>): Promise<{ id: string; target: PushTarget }[]> {
  const key = pushKey(deps);
  const f = eligibilityFilter(...args);
  const { rows } = await deps.pool.query<{ id: string; endpoint_enc: string; p256dh_enc: string; auth_enc: string }>(
    `SELECT id, endpoint_enc, p256dh_enc, auth_enc FROM push_subscriptions WHERE ${f.where}`,
    f.params,
  );
  return rows.map((r) => ({ id: r.id, target: { endpoint: open(key, r.endpoint_enc), keys: { p256dh: open(key, r.p256dh_enc), auth: open(key, r.auth_enc) } } }));
}
