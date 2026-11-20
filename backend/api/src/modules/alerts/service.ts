import type { AppDeps } from "../../deps.js";
import { withTransaction } from "../../db/pool.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { rooms } from "../../realtime/events.js";
import type { PushOptions, PushOutcome } from "../../services/push-sender.js";
import { writeAudit } from "../../services/audit.js";
import type { z } from "../../lib/zod.js";
import type { AlertLanguage, AlertSeverity } from "../../types/enums.js";
import { countEligible, loadTargets } from "../push/service.js";
import { ALL_AREAS, areaLabel, reachedAreas } from "./areas.js";
import type { AlertCreateBody, AlertListQuery } from "./schemas.js";

const DEMO_PREFIX = "[DEMO] ";
const DEMO_NOTE: Record<AlertLanguage, string> = {
  en: "Simulated demonstration alert. This is not an official warning.",
  hi: "यह डेमो अभ्यास संदेश है। यह आधिकारिक चेतावनी नहीं है।",
};
const URGENCY: Record<AlertSeverity, PushOptions["urgency"]> = { advisory: "normal", warning: "high", severe: "high", critical: "high" };

interface AlertRow {
  id: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  target_area: string;
  language: AlertLanguage;
  classification: "demo" | "verified";
  deliver_in_app: boolean;
  deliver_push: boolean;
  status: "draft" | "sending" | "sent" | "failed";
  expires_at: Date | null;
  created_at: Date;
  sent_at: Date | null;
}

interface DispatchRow {
  id: string;
  status: "running" | "completed" | "failed";
  idempotency_key: string;
  eligible_count: number;
  accepted_count: number;
  failed_count: number;
  invalid_count: number;
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
}

const toAlert = (r: AlertRow) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  severity: r.severity,
  targetArea: r.target_area,
  targetAreaLabel: areaLabel(r.target_area, r.language),
  language: r.language,
  classification: r.classification,
  deliverInApp: r.deliver_in_app,
  deliverPush: r.deliver_push,
  status: r.status,
  expiresAt: r.expires_at?.toISOString() ?? null,
  expired: r.expires_at !== null && r.expires_at.getTime() <= Date.now(),
  createdAt: r.created_at.toISOString(),
  sentAt: r.sent_at?.toISOString() ?? null,
});

const toDispatch = (d: DispatchRow) => ({
  id: d.id,
  status: d.status,
  eligible: d.eligible_count,
  accepted: d.accepted_count,
  failed: d.failed_count,
  invalid: d.invalid_count,
  error: d.error,
  startedAt: d.started_at.toISOString(),
  finishedAt: d.finished_at?.toISOString() ?? null,
});

/** The exact JSON the service worker receives. The URL is always same-origin and relative. */
export function notificationPayload(a: AlertRow) {
  return {
    alertId: a.id,
    title: a.title,
    body: a.classification === "demo" ? `${a.body}\n${DEMO_NOTE[a.language]}` : a.body,
    severity: a.severity,
    classification: a.classification,
    url: `/alerts?alert=${a.id}`,
    sentAt: a.sent_at?.toISOString() ?? null,
    expiresAt: a.expires_at?.toISOString() ?? null,
  };
}

async function getRow(deps: AppDeps, id: string) {
  const { rows } = await deps.pool.query<AlertRow>(`SELECT * FROM alerts WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound("Alert");
  return rows[0];
}

const eligibleArgs = (a: AlertRow) => [a.classification, reachedAreas(a.target_area), a.severity] as const;

export async function createAlert(deps: AppDeps, body: z.infer<typeof AlertCreateBody>, actorId: string) {
  // This build has no verified authoritative source, so every alert is a demonstration alert.
  const title = DEMO_PREFIX + body.title.replace(/^\s*\[DEMO\]\s*/i, "");
  const row = await withTransaction(deps.pool, async (db) => {
    const { rows } = await db.query<AlertRow>(
      `INSERT INTO alerts (title, body, severity, target_area, language, classification, deliver_in_app, deliver_push, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'demo', $6, $7, $8, $9) RETURNING *`,
      [title, body.body, body.severity, body.targetArea, body.language, body.deliverInApp, body.deliverPush, body.expiresAt ?? null, actorId],
    );
    await writeAudit(db, { actorId, action: "alert.create", entityType: "alert", entityId: rows[0]!.id, after: { title, severity: body.severity, targetArea: body.targetArea } });
    return rows[0]!;
  });
  return draftView(deps, row);
}

async function draftView(deps: AppDeps, row: AlertRow) {
  const pushEnabled = Boolean(deps.push && deps.config.push);
  return {
    alert: toAlert(row),
    preview: {
      notification: notificationPayload(row),
      audienceLabel: `${areaLabel(row.target_area)} · demonstration subscribers only`,
      eligibleSubscriptions: row.deliver_push && pushEnabled ? await countEligible(deps, ...eligibleArgs(row)) : 0,
      pushEnabled,
    },
  };
}

export async function getDraft(deps: AppDeps, id: string) {
  return draftView(deps, await getRow(deps, id));
}

export async function listAdminAlerts(deps: AppDeps) {
  const { rows } = await deps.pool.query<AlertRow & { d: DispatchRow | null }>(
    `SELECT a.*, to_jsonb(d) AS d FROM alerts a LEFT JOIN alert_dispatches d ON d.alert_id = a.id ORDER BY a.created_at DESC LIMIT 50`,
  );
  return {
    data: rows.map((r) => ({
      ...toAlert(r),
      dispatch: r.d ? toDispatch({ ...r.d, started_at: new Date(r.d.started_at), finished_at: r.d.finished_at ? new Date(r.d.finished_at) : null }) : null,
    })),
  };
}

/** Public: published in-app alerts, newest first. Expired alerts only on request, and flagged. */
export async function listPublished(deps: AppDeps, q: z.infer<typeof AlertListQuery>) {
  const areas = q.area ? reachedAreas(q.area) : null;
  const { rows } = await deps.pool.query<AlertRow>(
    `SELECT * FROM alerts WHERE status IN ('sending', 'sent') AND deliver_in_app
       AND ($1 OR expires_at IS NULL OR expires_at > now())
       AND ($2::text[] IS NULL OR target_area = $3 OR target_area = ANY($2::text[]))
     ORDER BY sent_at DESC LIMIT 50`,
    [q.includeExpired, areas, ALL_AREAS],
  );
  return { data: rows.map(toAlert), generatedAt: new Date().toISOString() };
}

export async function getPublished(deps: AppDeps, id: string) {
  const row = await getRow(deps, id);
  if (row.status === "draft") throw notFound("Alert");
  return toAlert(row);
}

export async function deliveryReport(deps: AppDeps, id: string) {
  const row = await getRow(deps, id);
  const d = await deps.pool.query<DispatchRow>(`SELECT * FROM alert_dispatches WHERE alert_id = $1`, [id]);
  const dispatch = d.rows[0];
  const deliveries = dispatch
    ? (
        await deps.pool.query<{ subscription_id: string; status: "accepted" | "failed" | "invalid"; http_status: number | null; attempts: number; error: string | null; created_at: Date }>(
          `SELECT subscription_id, status, http_status, attempts, error, created_at FROM alert_deliveries WHERE dispatch_id = $1 ORDER BY id`,
          [dispatch.id],
        )
      ).rows.map((r) => ({ subscriptionId: r.subscription_id, status: r.status, httpStatus: r.http_status, attempts: r.attempts, error: r.error, at: r.created_at.toISOString() }))
    : [];
  return { alert: toAlert(row), dispatch: dispatch ? toDispatch(dispatch) : null, deliveries };
}

/**
 * Publishes an alert once. The draft→sending transition and the unique dispatch row make a second send
 * a no-op (same Idempotency-Key) or a 409 (different key). Push delivery runs in the background.
 */
export async function sendAlert(deps: AppDeps, id: string, idempotencyKey: string, actorId: string) {
  const outcome = await withTransaction(deps.pool, async (db) => {
    const { rows } = await db.query<AlertRow>(`SELECT * FROM alerts WHERE id = $1 FOR UPDATE`, [id]);
    const alert = rows[0];
    if (!alert) throw notFound("Alert");
    if (alert.status !== "draft") {
      const existing = await db.query<DispatchRow>(`SELECT * FROM alert_dispatches WHERE alert_id = $1`, [id]);
      if (existing.rows[0]?.idempotency_key === idempotencyKey) return { alert, dispatch: existing.rows[0], replay: true };
      throw conflict("ALERT_ALREADY_SENT", "This alert has already been sent");
    }
    if (alert.expires_at && alert.expires_at.getTime() <= Date.now()) throw conflict("ALERT_EXPIRED", "This alert expired before it was sent");
    if (alert.deliver_push && !(deps.push && deps.config.push)) throw new AppError(503, "PUSH_NOT_CONFIGURED", "Push is not configured; untick push delivery or configure VAPID");
    const used = await db.query(`SELECT 1 FROM alert_dispatches WHERE idempotency_key = $1`, [idempotencyKey]);
    if (used.rowCount) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used for another alert");

    const sent = await db.query<AlertRow>(`UPDATE alerts SET status = $2, sent_at = now() WHERE id = $1 RETURNING *`, [id, alert.deliver_push ? "sending" : "sent"]);
    const dispatch = await db.query<DispatchRow>(
      `INSERT INTO alert_dispatches (alert_id, idempotency_key, requested_by, status, finished_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, idempotencyKey, actorId, alert.deliver_push ? "running" : "completed", alert.deliver_push ? null : new Date()],
    );
    await writeAudit(db, { actorId, action: "alert.send", entityType: "alert", entityId: id, after: { targetArea: alert.target_area, severity: alert.severity, deliverPush: alert.deliver_push } });
    return { alert: sent.rows[0]!, dispatch: dispatch.rows[0]!, replay: false };
  });

  if (!outcome.replay) {
    if (outcome.alert.deliver_in_app) {
      // Area alerts are public information; clients filter by their own chosen areas.
      deps.realtime.publish("alert.published", [rooms.public], { entityId: id, status: outcome.alert.status, data: { alert: toAlert(outcome.alert) } });
    }
    if (outcome.alert.deliver_push) {
      void runDispatch(deps, outcome.alert, outcome.dispatch.id).catch(async (err: unknown) => {
        deps.logger.error({ err, alertId: id }, "alert dispatch crashed");
        await deps.pool
          .query(`UPDATE alert_dispatches SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [outcome.dispatch.id, (err as Error).message.slice(0, 300)])
          .then(() => deps.pool.query(`UPDATE alerts SET status = 'failed' WHERE id = $1`, [id]))
          .catch(() => undefined);
        publishDispatch(deps, id, outcome.dispatch.id);
      });
    }
  }
  return { alert: toAlert(outcome.alert), dispatch: toDispatch(outcome.dispatch), replay: outcome.replay };
}

function publishDispatch(deps: AppDeps, alertId: string, dispatchId: string) {
  void deps.pool
    .query<DispatchRow>(`SELECT * FROM alert_dispatches WHERE id = $1`, [dispatchId])
    .then(({ rows }) => {
      if (rows[0]) deps.realtime.publish("alert.dispatch.updated", [rooms.admins], { entityId: alertId, status: rows[0].status, data: { dispatch: toDispatch(rows[0]) } });
    })
    .catch(() => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends with bounded concurrency; transient failures retry with backoff, permanent ones never do. */
export async function runDispatch(deps: AppDeps, alert: AlertRow, dispatchId: string) {
  const sender = deps.push!;
  const { PUSH_CONCURRENCY, PUSH_MAX_ATTEMPTS, PUSH_TTL_SECONDS } = deps.config;
  const targets = await loadTargets(deps, ...eligibleArgs(alert));
  await deps.pool.query(`UPDATE alert_dispatches SET eligible_count = $2 WHERE id = $1`, [dispatchId, targets.length]);

  const payload = JSON.stringify(notificationPayload(alert));
  const ttl = alert.expires_at ? Math.max(0, Math.min(PUSH_TTL_SECONDS, Math.floor((alert.expires_at.getTime() - Date.now()) / 1000))) : PUSH_TTL_SECONDS;
  const options: PushOptions = { ttlSeconds: ttl, urgency: URGENCY[alert.severity], topic: alert.id.replaceAll("-", "") };
  const counts = { accepted: 0, failed: 0, invalid: 0 };

  const deliver = async ({ id, target }: (typeof targets)[number]) => {
    let result: PushOutcome = { kind: "transient", statusCode: null, error: "not attempted" };
    let attempts = 0;
    while (attempts < PUSH_MAX_ATTEMPTS) {
      attempts++;
      try {
        result = await sender.send(target, payload, options);
      } catch (err) {
        result = { kind: "permanent", statusCode: 0, error: (err as Error).message }; // e.g. malformed keys
      }
      if (result.kind !== "transient" || attempts === PUSH_MAX_ATTEMPTS) break;
      await sleep(Math.min(result.retryAfterMs ?? 500 * 2 ** (attempts - 1), 5000));
    }
    const status = result.kind === "accepted" ? "accepted" : result.kind === "invalid" ? "invalid" : "failed";
    counts[status]++;
    const error = "error" in result ? result.error.slice(0, 300) : null;
    await deps.pool.query(
      `INSERT INTO alert_deliveries (dispatch_id, subscription_id, status, http_status, attempts, error) VALUES ($1, $2, $3, $4, $5, $6)`,
      [dispatchId, id, status, result.statusCode, attempts, error],
    );
    if (status === "accepted") await deps.pool.query(`UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1`, [id]);
    if (status === "invalid") {
      await deps.pool.query(`UPDATE push_subscriptions SET invalidated_at = now(), invalidated_reason = $2 WHERE id = $1 AND invalidated_at IS NULL`, [id, `push service ${result.statusCode}`]);
    }
  };

  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await deliver(t);
    }),
  );

  await deps.pool.query(
    `UPDATE alert_dispatches SET status = 'completed', accepted_count = $2, failed_count = $3, invalid_count = $4, finished_at = now() WHERE id = $1`,
    [dispatchId, counts.accepted, counts.failed, counts.invalid],
  );
  await deps.pool.query(`UPDATE alerts SET status = 'sent' WHERE id = $1`, [alert.id]);
  deps.logger.info({ alertId: alert.id, eligible: targets.length, ...counts }, "alert dispatch finished");
  publishDispatch(deps, alert.id, dispatchId);
}
