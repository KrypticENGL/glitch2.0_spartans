import type { z } from "zod";
import { withTransaction, type Queryable } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { rooms } from "../../realtime/events.js";
import { writeAudit } from "../../services/audit.js";
import type { IncidentStatus, MissionStatus } from "../../types/enums.js";
import type { MissionCreateBody, MissionListQuery, MissionStatusBody, TeamListQuery } from "./schemas.js";

export const TERMINAL_MISSION: readonly MissionStatus[] = ["completed", "cancelled"];

/** Mission state machine. Cancelling is allowed from any non-terminal state. */
export const MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  assigned: ["accepted", "cancelled"],
  accepted: ["en_route", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Incident status implied by its mission's status. A cancelled mission returns the incident to the queue. */
export const INCIDENT_STATUS_FOR_MISSION: Record<MissionStatus, IncidentStatus> = {
  assigned: "assigned",
  accepted: "assigned",
  en_route: "en_route",
  on_site: "on_site",
  completed: "resolved",
  cancelled: "new",
};

interface TeamRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  members: number;
  availability: "available" | "on_mission" | "off_duty";
  capabilities: string[];
  location: { type: "Point"; coordinates: [number, number] };
  lead_name: string | null;
  lead_phone: string | null;
  active_mission_count: number;
  updated_at: Date;
}

interface MissionRow {
  id: string;
  code: string;
  status: MissionStatus;
  sos_request_id: string;
  rescue_team_id: string;
  team_name: string;
  assigned_by: string | null;
  assigned_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  notes: string | null;
  sos_code: string;
  sos_status: IncidentStatus;
  sos_priority: string;
  sos_type: string;
  sos_people: number;
  sos_area: string | null;
  sos_location: { type: "Point"; coordinates: [number, number] };
  total_count?: number;
}

const TEAM_SELECT = `SELECT t.id, t.code, t.name, t.kind, t.members, t.availability, t.capabilities, ST_AsGeoJSON(t.current_location)::json AS location,
  t.lead_name, t.lead_phone, t.updated_at,
  (SELECT count(*)::int FROM rescue_missions m WHERE m.rescue_team_id = t.id AND m.status NOT IN ('completed','cancelled')) AS active_mission_count
  FROM rescue_teams t`;

const MISSION_SELECT = `SELECT m.id, m.code, m.status, m.sos_request_id, m.rescue_team_id, t.name AS team_name, m.assigned_by, m.assigned_at,
  m.updated_at, m.completed_at, m.notes, s.code AS sos_code, s.status AS sos_status, s.priority AS sos_priority, s.emergency_type AS sos_type,
  s.people_count AS sos_people, s.area AS sos_area, ST_AsGeoJSON(s.location)::json AS sos_location
  FROM rescue_missions m JOIN rescue_teams t ON t.id = m.rescue_team_id JOIN sos_requests s ON s.id = m.sos_request_id`;

const toTeam = (r: TeamRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  members: r.members,
  availability: r.availability,
  capabilities: r.capabilities,
  location: r.location,
  leadName: r.lead_name,
  leadPhone: r.lead_phone,
  activeMissionCount: r.active_mission_count,
  updatedAt: r.updated_at.toISOString(),
});

export const toMission = (r: MissionRow) => ({
  id: r.id,
  code: r.code,
  status: r.status,
  sosRequestId: r.sos_request_id,
  rescueTeamId: r.rescue_team_id,
  teamName: r.team_name,
  assignedBy: r.assigned_by,
  assignedAt: r.assigned_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
  completedAt: r.completed_at?.toISOString() ?? null,
  notes: r.notes,
  incident: {
    code: r.sos_code,
    status: r.sos_status,
    priority: r.sos_priority,
    emergencyType: r.sos_type,
    peopleCount: r.sos_people,
    area: r.sos_area,
    location: r.sos_location,
  },
});

export async function listTeams(deps: AppDeps, q: z.infer<typeof TeamListQuery>) {
  const { rows } = await deps.pool.query<TeamRow>(
    `${TEAM_SELECT} ${q.availability ? "WHERE t.availability = ANY($1::team_availability[])" : ""} ORDER BY t.code`,
    q.availability ? [q.availability] : [],
  );
  return { data: rows.map(toTeam) };
}

export async function getTeam(deps: AppDeps, id: string) {
  const { rows } = await deps.pool.query<TeamRow>(`${TEAM_SELECT} WHERE t.id = $1`, [id]);
  if (!rows[0]) throw notFound("Rescue team");
  return toTeam(rows[0]);
}

async function fetchMission(db: Queryable, id: string) {
  const { rows } = await db.query<MissionRow>(`${MISSION_SELECT} WHERE m.id = $1`, [id]);
  if (!rows[0]) throw notFound("Mission");
  return rows[0];
}

/** A team is on_mission while it has any active mission; otherwise available (off_duty is left untouched). */
export async function syncTeamAvailability(db: Queryable, teamId: string): Promise<void> {
  await db.query(
    `UPDATE rescue_teams t SET
       availability = CASE
         WHEN EXISTS (SELECT 1 FROM rescue_missions m WHERE m.rescue_team_id = t.id AND m.status NOT IN ('completed','cancelled')) THEN 'on_mission'::team_availability
         WHEN t.availability = 'on_mission' THEN 'available'::team_availability
         ELSE t.availability END,
       updated_at = now()
     WHERE t.id = $1`,
    [teamId],
  );
}

export interface MissionChange {
  missionId: string;
  code: string;
  teamId: string;
  sosRequestId: string;
  previousStatus: MissionStatus;
  status: MissionStatus;
}

/** Cancels the active mission of an SOS (if any) inside the caller's transaction and frees its team. */
export async function cancelActiveMission(c: Queryable, sosRequestId: string, reason: string, actorId: string | null): Promise<MissionChange | null> {
  const { rows } = await c.query<{ id: string; code: string; status: MissionStatus; rescue_team_id: string }>(
    `SELECT id, code, status, rescue_team_id FROM rescue_missions WHERE sos_request_id = $1 AND status NOT IN ('completed','cancelled') FOR UPDATE`,
    [sosRequestId],
  );
  const m = rows[0];
  if (!m) return null;
  await c.query(`UPDATE rescue_missions SET status = 'cancelled', completed_at = now(), updated_at = now() WHERE id = $1`, [m.id]);
  await syncTeamAvailability(c, m.rescue_team_id);
  await writeAudit(c, { actorId, action: "mission.cancel", entityType: "rescue_mission", entityId: m.id, before: { status: m.status }, after: { status: "cancelled" }, reason });
  return { missionId: m.id, code: m.code, teamId: m.rescue_team_id, sosRequestId, previousStatus: m.status, status: "cancelled" };
}

export function publishMissionStatus(deps: AppDeps, change: MissionChange): void {
  deps.realtime.publish("mission.status.updated", [rooms.admins, rooms.team(change.teamId)], {
    entityId: change.missionId,
    status: change.status,
    data: { ...change },
  });
}

export async function createMission(deps: AppDeps, body: z.infer<typeof MissionCreateBody>, actorId: string) {
  const { mission, cancelled } = await withTransaction(deps.pool, async (c) => {
    const sos = await c.query<{ status: IncidentStatus }>(`SELECT status FROM sos_requests WHERE id = $1 FOR UPDATE`, [body.sosRequestId]);
    if (!sos.rows[0]) throw notFound("SOS request");
    if (sos.rows[0].status === "resolved" || sos.rows[0].status === "cancelled") {
      throw conflict("INCIDENT_CLOSED", `Incident is ${sos.rows[0].status}`, { status: sos.rows[0].status });
    }
    const team = await c.query<{ availability: string; name: string }>(`SELECT availability, name FROM rescue_teams WHERE id = $1 FOR UPDATE`, [body.rescueTeamId]);
    if (!team.rows[0]) throw notFound("Rescue team");
    if (team.rows[0].availability === "off_duty") throw conflict("TEAM_OFF_DUTY", "Rescue team is off duty");
    const current = await c.query<{ rescue_team_id: string }>(
      `SELECT rescue_team_id FROM rescue_missions WHERE sos_request_id = $1 AND status NOT IN ('completed','cancelled')`,
      [body.sosRequestId],
    );
    if (current.rows[0]?.rescue_team_id === body.rescueTeamId) throw conflict("ALREADY_ASSIGNED", "This team already has the active mission for this incident");

    const cancelled = await cancelActiveMission(c, body.sosRequestId, `Reassigned to ${team.rows[0].name}`, actorId);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO rescue_missions (code, sos_request_id, rescue_team_id, assigned_by, notes)
       VALUES ('MSN-' || lpad(nextval('mission_code_seq')::text, 6, '0'), $1, $2, $3, $4) RETURNING id`,
      [body.sosRequestId, body.rescueTeamId, actorId, body.notes ?? null],
    );
    const missionId = rows[0]!.id;
    await c.query(`UPDATE sos_requests SET status = 'assigned', updated_at = now() WHERE id = $1`, [body.sosRequestId]);
    await syncTeamAvailability(c, body.rescueTeamId);
    await writeAudit(c, {
      actorId,
      action: "mission.assign",
      entityType: "rescue_mission",
      entityId: missionId,
      before: { incidentStatus: sos.rows[0].status, previousMission: cancelled?.missionId ?? null },
      after: { status: "assigned", rescueTeamId: body.rescueTeamId, sosRequestId: body.sosRequestId },
    });
    return { mission: await fetchMission(c, missionId), cancelled };
  });
  if (cancelled) publishMissionStatus(deps, cancelled);
  const view = toMission(mission);
  deps.realtime.publish("mission.assigned", [rooms.admins, rooms.team(mission.rescue_team_id)], { entityId: mission.id, status: mission.status, data: view });
  return view;
}

function assertMissionAccess(user: AuthUser, teamId: string) {
  if (user.role === "admin") return;
  if (user.role === "responder" && user.teamId === teamId) return;
  throw forbidden("Mission belongs to another team");
}

export async function listMissions(deps: AppDeps, q: z.infer<typeof MissionListQuery>, user: AuthUser) {
  const teamId = user.role === "admin" ? q.teamId : user.teamId;
  if (user.role !== "admin" && !teamId) return { data: [], page: q.page, pageSize: q.pageSize, total: 0 };
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (teamId) where.push(`m.rescue_team_id = ${p(teamId)}`);
  if (q.status) where.push(`m.status = ANY(${p(q.status)}::mission_status[])`);
  const { rows } = await deps.pool.query<MissionRow>(
    `${MISSION_SELECT.replace("SELECT ", "SELECT count(*) OVER() AS total_count, ")} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY (m.status IN ('completed','cancelled')), s.priority, m.assigned_at DESC
     LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`,
    params,
  );
  return { data: rows.map(toMission), page: q.page, pageSize: q.pageSize, total: rows[0]?.total_count ?? 0 };
}

export async function getMission(deps: AppDeps, id: string, user: AuthUser) {
  const m = await fetchMission(deps.pool, id);
  assertMissionAccess(user, m.rescue_team_id);
  return toMission(m);
}

export async function setMissionStatus(deps: AppDeps, id: string, body: z.infer<typeof MissionStatusBody>, user: AuthUser) {
  const { mission, change } = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<{ status: MissionStatus; rescue_team_id: string; sos_request_id: string; code: string }>(
      `SELECT status, rescue_team_id, sos_request_id, code FROM rescue_missions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const m = rows[0];
    if (!m) throw notFound("Mission");
    assertMissionAccess(user, m.rescue_team_id);
    if (!MISSION_TRANSITIONS[m.status].includes(body.status)) {
      throw conflict("INVALID_TRANSITION", `Cannot move mission from ${m.status} to ${body.status}`, {
        from: m.status,
        to: body.status,
        allowed: MISSION_TRANSITIONS[m.status],
      });
    }
    const terminal = TERMINAL_MISSION.includes(body.status);
    await c.query(
      `UPDATE rescue_missions SET status = $2, updated_at = now(), completed_at = CASE WHEN $3 THEN now() ELSE NULL END,
         notes = CASE WHEN $4::text IS NULL THEN notes ELSE concat_ws(E'\\n', notes, $4::text) END
       WHERE id = $1`,
      [id, body.status, terminal, body.notes ?? null],
    );
    const sos = await c.query<{ status: IncidentStatus }>(`SELECT status FROM sos_requests WHERE id = $1 FOR UPDATE`, [m.sos_request_id]);
    const sosBefore = sos.rows[0]!.status;
    if (sosBefore !== "resolved" && sosBefore !== "cancelled") {
      await c.query(`UPDATE sos_requests SET status = $2, updated_at = now() WHERE id = $1`, [m.sos_request_id, INCIDENT_STATUS_FOR_MISSION[body.status]]);
    }
    await syncTeamAvailability(c, m.rescue_team_id);
    await writeAudit(c, {
      actorId: user.id,
      action: "mission.status.update",
      entityType: "rescue_mission",
      entityId: id,
      before: { status: m.status, incidentStatus: sosBefore },
      after: { status: body.status },
      reason: body.notes ?? null,
    });
    const change: MissionChange = { missionId: id, code: m.code, teamId: m.rescue_team_id, sosRequestId: m.sos_request_id, previousStatus: m.status, status: body.status };
    return { mission: await fetchMission(c, id), change };
  });
  publishMissionStatus(deps, change);
  return toMission(mission);
}
