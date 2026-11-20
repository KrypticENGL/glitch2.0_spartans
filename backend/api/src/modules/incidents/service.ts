import type { z } from "zod";
import { withTransaction, type Queryable } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { conflict, notFound } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { rooms } from "../../realtime/events.js";
import { writeAudit } from "../../services/audit.js";
import type { IncidentStatus, IncidentType, MissionStatus, PriorityLevel } from "../../types/enums.js";
import { cancelActiveMission, publishMissionStatus } from "../rescue/service.js";
import { computePriority, type PriorityConfig, type PriorityFactor } from "./priority.js";
import type { IncidentListQuery, IncidentStatusBody, PriorityOverrideBody, SosCreateBody } from "./schemas.js";

interface SosRow {
  id: string;
  code: string;
  status: IncidentStatus;
  priority: PriorityLevel;
  suggested_priority: PriorityLevel;
  priority_score: number;
  priority_breakdown: PriorityFactor[];
  priority_overridden: boolean;
  emergency_type: IncidentType;
  people_count: number;
  children_count: number;
  elderly_count: number;
  disabled_count: number;
  medical_needed: boolean;
  trapped: boolean;
  life_threatening: boolean;
  notes: string | null;
  contact_phone: string | null;
  area: string | null;
  location: { type: "Point"; coordinates: [number, number] };
  source: string;
  requester_id: string | null;
  idempotency_key: string | null;
  waiting_minutes: number;
  created_at: Date;
  updated_at: Date;
  mission_id: string | null;
  mission_code: string | null;
  mission_status: MissionStatus | null;
  mission_team_id: string | null;
  total_count?: number;
}

const SELECT_SOS = `SELECT s.id, s.code, s.status, s.priority, s.suggested_priority, s.priority_score, s.priority_breakdown, s.priority_overridden,
  s.emergency_type, s.people_count, s.children_count, s.elderly_count, s.disabled_count, s.medical_needed, s.trapped, s.life_threatening,
  s.notes, s.contact_phone, s.area, ST_AsGeoJSON(s.location)::json AS location, s.source, s.requester_id, s.idempotency_key,
  floor(extract(epoch FROM now() - s.created_at) / 60)::int AS waiting_minutes, s.created_at, s.updated_at,
  m.id AS mission_id, m.code AS mission_code, m.status AS mission_status, m.rescue_team_id AS mission_team_id
  FROM sos_requests s
  LEFT JOIN rescue_missions m ON m.sos_request_id = s.id AND m.status NOT IN ('completed', 'cancelled')`;

export const toIncident = (r: SosRow) => ({
  id: r.id,
  code: r.code,
  status: r.status,
  priority: r.priority,
  suggestedPriority: r.suggested_priority,
  priorityScore: r.priority_score,
  priorityBreakdown: r.priority_breakdown,
  priorityOverridden: r.priority_overridden,
  emergencyType: r.emergency_type,
  peopleCount: r.people_count,
  childrenCount: r.children_count,
  elderlyCount: r.elderly_count,
  disabledCount: r.disabled_count,
  medicalNeeded: r.medical_needed,
  trapped: r.trapped,
  lifeThreatening: r.life_threatening,
  notes: r.notes,
  contactPhone: r.contact_phone,
  area: r.area,
  location: r.location,
  source: r.source,
  requesterId: r.requester_id,
  waitingMinutes: Math.max(0, r.waiting_minutes),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  activeMission: r.mission_id
    ? { id: r.mission_id, code: r.mission_code!, status: r.mission_status!, rescueTeamId: r.mission_team_id! }
    : null,
});

export async function fetchSos(db: Queryable, id: string) {
  const { rows } = await db.query<SosRow>(`${SELECT_SOS} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw notFound("SOS request");
  return rows[0];
}

async function countNearbyHazards(db: Queryable, lon: number, lat: number, radius: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM hazard_reports
     WHERE verification_status = 'verified' AND ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
    [lon, lat, radius],
  );
  return rows[0]!.n;
}

export type SosInput = z.infer<typeof SosCreateBody>;

/**
 * Scores and inserts one SOS request (shared by the API and the demo seeder so both use the same priority rules).
 * Returns null when the idempotency key already exists.
 */
export async function insertSos(
  db: Queryable,
  input: SosInput,
  opts: { config: PriorityConfig; requesterId: string | null; idempotencyKey: string | null; source?: string; code?: string; minutesAgo?: number },
): Promise<string | null> {
  const nearby = await countNearbyHazards(db, input.location.longitude, input.location.latitude, opts.config.hazardRadiusMeters);
  const p = computePriority({ ...input, nearbyVerifiedHazards: nearby, waitingMinutes: opts.minutesAgo ?? 0 }, opts.config);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sos_requests (code, requester_id, contact_phone, location, area, emergency_type, people_count, medical_needed, trapped,
       life_threatening, children_count, elderly_count, disabled_count, notes, suggested_priority, priority_score, priority_breakdown,
       priority, idempotency_key, source, created_at, updated_at)
     VALUES (coalesce($1, 'SOS-' || lpad(nextval('sos_code_seq')::text, 6, '0')), $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $16, $19, $20, now() - make_interval(mins => $21), now() - make_interval(mins => $21))
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      opts.code ?? null,
      opts.requesterId,
      input.contactPhone ?? null,
      input.location.longitude,
      input.location.latitude,
      input.area ?? null,
      input.emergencyType,
      input.peopleCount,
      input.medicalNeeded,
      input.trapped,
      input.lifeThreatening,
      input.childrenCount,
      input.elderlyCount,
      input.disabledCount,
      input.notes ?? null,
      p.level,
      p.score,
      JSON.stringify(p.breakdown),
      opts.idempotencyKey,
      opts.source ?? "citizen",
      opts.minutesAgo ?? 0,
    ],
  );
  return rows[0]?.id ?? null;
}

async function findByIdempotencyKey(deps: AppDeps, key: string, requesterId: string | null) {
  const { rows } = await deps.pool.query<SosRow>(`${SELECT_SOS} WHERE s.idempotency_key = $1`, [key]);
  const row = rows[0];
  if (!row) return null;
  // A key only replays for the same submitter; never hand one requester's SOS to another.
  if (row.requester_id !== requesterId) throw conflict("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request");
  return row;
}

export async function createSos(deps: AppDeps, body: SosInput, user: AuthUser | null, idempotencyKey: string | undefined) {
  const requesterId = user?.id ?? null;
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(deps, idempotencyKey, requesterId);
    if (existing) return { created: false, incident: toIncident(existing) };
  }
  const row = await withTransaction(deps.pool, async (c) => {
    const id = await insertSos(c, body, { config: deps.config.priority, requesterId, idempotencyKey: idempotencyKey ?? null });
    if (!id) return null; // lost a race against the same key
    await writeAudit(c, { actorId: requesterId, action: "sos.create", entityType: "sos_request", entityId: id });
    return fetchSos(c, id);
  });
  if (!row) {
    const existing = await findByIdempotencyKey(deps, idempotencyKey!, requesterId);
    return { created: false, incident: toIncident(existing!) };
  }
  const incident = toIncident(row);
  deps.realtime.publish("sos.created", [rooms.admins], { entityId: row.id, status: row.status, data: incident });
  return { created: true, incident };
}

export async function getSosFor(deps: AppDeps, id: string, user: AuthUser) {
  const row = await fetchSos(deps.pool, id);
  const allowed = user.role === "admin" || user.role === "responder" || row.requester_id === user.id;
  if (!allowed) throw notFound("SOS request"); // don't confirm existence to other citizens
  return toIncident(row);
}

export async function listIncidents(deps: AppDeps, q: z.infer<typeof IncidentListQuery>) {
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (q.status) where.push(`s.status = ANY(${p(q.status)}::incident_status[])`);
  if (q.priority) where.push(`s.priority = ANY(${p(q.priority)}::priority_level[])`);
  const { rows } = await deps.pool.query<SosRow & { total_count: number }>(
    `${SELECT_SOS.replace("SELECT ", "SELECT count(*) OVER() AS total_count, ")}
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY s.priority ASC, s.created_at ASC
     LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`,
    params,
  );
  return { data: rows.map(toIncident), page: q.page, pageSize: q.pageSize, total: rows[0]?.total_count ?? 0 };
}

const CLOSED: IncidentStatus[] = ["resolved", "cancelled"];

export async function setIncidentStatus(deps: AppDeps, id: string, body: z.infer<typeof IncidentStatusBody>, actorId: string) {
  const { row, cancelled } = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ status: IncidentStatus }>(`SELECT status FROM sos_requests WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound("SOS request");
    const from = rows[0].status;
    const reopening = body.status === "new";
    if (reopening ? !CLOSED.includes(from) : CLOSED.includes(from)) {
      throw conflict("INVALID_TRANSITION", `Cannot change incident from ${from} to ${body.status}`, { from, to: body.status });
    }
    const cancelled = reopening ? null : await cancelActiveMission(c, id, `Incident ${body.status}: ${body.reason}`, actorId);
    await c.query(`UPDATE sos_requests SET status = $2, updated_at = now() WHERE id = $1`, [id, body.status]);
    await writeAudit(c, { actorId, action: "incident.status.update", entityType: "sos_request", entityId: id, before: { status: from }, after: { status: body.status }, reason: body.reason });
    return { row: await fetchSos(c, id), cancelled };
  });
  if (cancelled) publishMissionStatus(deps, cancelled);
  return toIncident(row);
}

export async function overridePriority(deps: AppDeps, id: string, body: z.infer<typeof PriorityOverrideBody>, actorId: string) {
  const row = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ priority: PriorityLevel; suggested_priority: PriorityLevel }>(
      `SELECT priority, suggested_priority FROM sos_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw notFound("SOS request");
    await c.query(`UPDATE sos_requests SET priority = $2, priority_overridden = true, updated_at = now() WHERE id = $1`, [id, body.priority]);
    await writeAudit(c, {
      actorId,
      action: "incident.priority.override",
      entityType: "sos_request",
      entityId: id,
      before: { priority: rows[0].priority, suggestedPriority: rows[0].suggested_priority },
      after: { priority: body.priority },
      reason: body.reason,
    });
    return fetchSos(c, id);
  });
  return toIncident(row);
}

/** Re-runs the rules (waiting time and nearby hazards change over time). An operator override is kept. */
export async function reevaluatePriority(deps: AppDeps, id: string, actorId: string) {
  const row = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<SosRow>(`${SELECT_SOS} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
    const s = rows[0];
    if (!s) throw notFound("SOS request");
    const [lon, lat] = s.location.coordinates;
    const nearby = await countNearbyHazards(c, lon, lat, deps.config.priority.hazardRadiusMeters);
    const p = computePriority(
      {
        emergencyType: s.emergency_type,
        peopleCount: s.people_count,
        lifeThreatening: s.life_threatening,
        medicalNeeded: s.medical_needed,
        trapped: s.trapped,
        childrenCount: s.children_count,
        elderlyCount: s.elderly_count,
        disabledCount: s.disabled_count,
        nearbyVerifiedHazards: nearby,
        waitingMinutes: s.waiting_minutes,
      },
      deps.config.priority,
    );
    await c.query(
      `UPDATE sos_requests SET suggested_priority = $2, priority_score = $3, priority_breakdown = $4,
         priority = CASE WHEN priority_overridden THEN priority ELSE $2 END, updated_at = now() WHERE id = $1`,
      [id, p.level, p.score, JSON.stringify(p.breakdown)],
    );
    await writeAudit(c, { actorId, action: "incident.priority.reevaluate", entityType: "sos_request", entityId: id, before: { score: s.priority_score }, after: { score: p.score, level: p.level } });
    return fetchSos(c, id);
  });
  return toIncident(row);
}
