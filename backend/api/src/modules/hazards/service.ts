import type { z } from "zod";
import { withTransaction, type Queryable } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { conflict, forbidden, notFound, unprocessable } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { rooms } from "../../realtime/events.js";
import { writeAudit } from "../../services/audit.js";
import type { HazardVerification, RoadStatus } from "../../types/enums.js";
import { applyRoadStatusChange, publishRoadChange, type RoadChange } from "../roads/service.js";
import type { HazardCreateBody, HazardListQuery, HazardStatusBody, HazardVerifyBody } from "./schemas.js";

/** A report snaps to the nearest road edge only if one lies within this distance. */
export const HAZARD_SNAP_METERS = 30;

interface HazardRow {
  id: string;
  location: { type: "Point"; coordinates: [number, number] };
  road_edge_id: number | null;
  hazard_type: string;
  severity: string;
  description: string;
  source: string;
  verification_status: HazardVerification;
  applied_road_status: RoadStatus | null;
  reported_by: string | null;
  reported_at: Date;
  verified_at: Date | null;
  verified_by: string | null;
  total_count?: number;
}

const COLUMNS = `h.id, ST_AsGeoJSON(h.location)::json AS location, h.road_edge_id, h.hazard_type, h.severity, h.description, h.source,
  h.verification_status, h.applied_road_status, h.reported_by, h.reported_at, h.verified_at, h.verified_by`;

const isStaff = (u?: AuthUser | null) => u?.role === "admin" || u?.role === "responder";

const toHazard = (r: HazardRow, staff: boolean) => ({
  id: r.id,
  location: r.location,
  roadEdgeId: r.road_edge_id,
  hazardType: r.hazard_type,
  severity: r.severity,
  description: r.description,
  source: r.source,
  verificationStatus: r.verification_status,
  appliedRoadStatus: r.applied_road_status,
  reportedAt: r.reported_at.toISOString(),
  verifiedAt: r.verified_at?.toISOString() ?? null,
  ...(staff && { reportedBy: r.reported_by, verifiedBy: r.verified_by }),
});

const roadSummary = (c: RoadChange) => ({
  edgeId: c.edgeId,
  status: c.status,
  changed: c.changed,
  graphVersion: c.graphVersion,
  invalidatedRouteCount: c.invalidatedRoutes.length,
});

async function fetchHazard(db: Queryable, id: string, lock = false) {
  const { rows } = await db.query<HazardRow>(`SELECT ${COLUMNS} FROM hazard_reports h WHERE h.id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  if (!rows[0]) throw notFound("Hazard");
  return rows[0];
}

export async function createHazard(deps: AppDeps, body: z.infer<typeof HazardCreateBody>, user: AuthUser | null) {
  const isAdmin = user?.role === "admin";
  if (!isAdmin && (body.verified !== undefined || body.appliedRoadStatus !== undefined)) {
    throw forbidden("Only administrators can submit pre-verified hazards");
  }
  const source = isAdmin ? "admin" : user?.role === "responder" ? "official" : "citizen";
  const verified = isAdmin && body.verified === true;

  const { row, change } = await withTransaction(deps.pool, async (c) => {
    const { rows } = await c.query<HazardRow>(
      `WITH pt AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS g),
       nearest AS (
         SELECT e.id FROM road_edges e, pt
         WHERE ST_DWithin(e.geom::geography, pt.g::geography, $3)
         ORDER BY e.geom <-> pt.g LIMIT 1)
       INSERT INTO hazard_reports (location, road_edge_id, hazard_type, severity, description, source, verification_status, reported_by, verified_at, verified_by)
       SELECT pt.g, (SELECT id FROM nearest), $4, $5, $6, $7, $8, $9, $10, $11 FROM pt
       RETURNING id`,
      [
        body.location.longitude,
        body.location.latitude,
        HAZARD_SNAP_METERS,
        body.hazardType,
        body.severity,
        body.description,
        source,
        verified ? "verified" : "unverified",
        user?.id ?? null,
        verified ? new Date() : null,
        verified ? user.id : null,
      ],
    );
    const created = await fetchHazard(c, rows[0]!.id);
    let change: RoadChange | null = null;
    if (verified && body.appliedRoadStatus) {
      if (created.road_edge_id === null) throw unprocessable("HAZARD_NOT_ON_ROAD", `No road within ${HAZARD_SNAP_METERS} m of the hazard; cannot apply a road status`);
      change = await applyRoadStatusChange(c, {
        edgeId: created.road_edge_id,
        status: body.appliedRoadStatus,
        reason: `Hazard ${created.id} (${body.hazardType}, ${body.severity})`,
        actorId: user.id,
        auditAction: "hazard.road_status.apply",
      });
      await c.query(`UPDATE hazard_reports SET applied_road_status = $2 WHERE id = $1`, [created.id, body.appliedRoadStatus]);
    }
    await writeAudit(c, { actorId: user?.id ?? null, action: "hazard.report", entityType: "hazard", entityId: created.id, after: { source, verified, appliedRoadStatus: body.appliedRoadStatus ?? null } });
    return { row: await fetchHazard(c, created.id), change };
  });

  deps.realtime.publish("hazard.reported", [rooms.admins], { entityId: row.id, status: row.verification_status, data: toHazard(row, true) });
  if (verified) deps.realtime.publish("hazard.verified", [rooms.admins, rooms.public], { entityId: row.id, status: "verified", data: toHazard(row, false) });
  if (change) publishRoadChange(deps, change);
  return { hazard: toHazard(row, isStaff(user)), road: change ? roadSummary(change) : null };
}

export async function listHazards(deps: AppDeps, q: z.infer<typeof HazardListQuery>, user: AuthUser | null) {
  const staff = isStaff(user);
  const statuses = staff ? q.status : ["verified"];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where = statuses ? `WHERE h.verification_status = ANY(${p(statuses)}::hazard_verification[])` : "";
  const { rows } = await deps.pool.query<HazardRow>(
    `SELECT ${COLUMNS}, count(*) OVER() AS total_count FROM hazard_reports h ${where}
     ORDER BY h.reported_at DESC LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`,
    params,
  );
  return { data: rows.map((r) => toHazard(r, staff)), page: q.page, pageSize: q.pageSize, total: rows[0]?.total_count ?? 0 };
}

export async function getHazard(deps: AppDeps, id: string, user: AuthUser | null) {
  const row = await fetchHazard(deps.pool, id);
  const visible = row.verification_status === "verified" || isStaff(user) || (user !== null && row.reported_by === user.id);
  if (!visible) throw notFound("Hazard"); // don't reveal unverified reports to the public
  return toHazard(row, isStaff(user));
}

export async function verifyHazard(deps: AppDeps, id: string, body: z.infer<typeof HazardVerifyBody>, actorId: string) {
  const { row, change } = await withTransaction(deps.pool, async (c) => {
    const before = await fetchHazard(c, id, true);
    if (before.verification_status !== "unverified") {
      throw conflict("INVALID_TRANSITION", `Hazard is already ${before.verification_status}`, { from: before.verification_status, to: body.decision });
    }
    const applied = body.decision === "verified" ? (body.appliedRoadStatus ?? null) : null;
    if (applied && before.road_edge_id === null) {
      throw unprocessable("HAZARD_NOT_ON_ROAD", `No road within ${HAZARD_SNAP_METERS} m of the hazard; cannot apply a road status`);
    }
    await c.query(
      `UPDATE hazard_reports SET verification_status = $2, applied_road_status = $3, verified_at = now(), verified_by = $4 WHERE id = $1`,
      [id, body.decision, applied, actorId],
    );
    const change =
      applied && before.road_edge_id !== null
        ? await applyRoadStatusChange(c, {
            edgeId: before.road_edge_id,
            status: applied,
            reason: body.reason ?? `Verified hazard ${id} (${before.hazard_type}, ${before.severity})`,
            actorId,
            auditAction: "hazard.road_status.apply",
          })
        : null;
    await writeAudit(c, {
      actorId,
      action: "hazard.verify",
      entityType: "hazard",
      entityId: id,
      before: { verificationStatus: before.verification_status },
      after: { verificationStatus: body.decision, appliedRoadStatus: applied },
      reason: body.reason ?? null,
    });
    return { row: await fetchHazard(c, id), change };
  });
  const targets = body.decision === "verified" ? [rooms.admins, rooms.public] : [rooms.admins];
  deps.realtime.publish("hazard.verified", targets, { entityId: id, status: row.verification_status, data: toHazard(row, false) });
  if (change) publishRoadChange(deps, change);
  return { hazard: toHazard(row, true), road: change ? roadSummary(change) : null };
}

export async function setHazardStatus(deps: AppDeps, id: string, body: z.infer<typeof HazardStatusBody>, actorId: string) {
  const { row, change, note } = await withTransaction(deps.pool, async (c) => {
    const before = await fetchHazard(c, id, true);
    if (before.verification_status !== "verified") {
      throw conflict("INVALID_TRANSITION", `Only verified hazards can be resolved (hazard is ${before.verification_status})`, { from: before.verification_status, to: body.status });
    }
    await c.query(`UPDATE hazard_reports SET verification_status = 'resolved' WHERE id = $1`, [id]);
    let change: RoadChange | null = null;
    let note: string | undefined;
    if (body.reopenRoad && before.road_edge_id !== null && before.applied_road_status !== null) {
      const others = await c.query(
        `SELECT 1 FROM hazard_reports WHERE road_edge_id = $1 AND id <> $2 AND verification_status = 'verified' AND applied_road_status IS NOT NULL LIMIT 1`,
        [before.road_edge_id, id],
      );
      if (others.rowCount) {
        note = "Road left unchanged: another verified hazard still affects it";
      } else {
        change = await applyRoadStatusChange(c, {
          edgeId: before.road_edge_id,
          status: "open",
          reason: body.reason ?? `Hazard ${id} resolved`,
          actorId,
          auditAction: "hazard.road_status.reopen",
        });
      }
    }
    await writeAudit(c, {
      actorId,
      action: "hazard.resolve",
      entityType: "hazard",
      entityId: id,
      before: { verificationStatus: before.verification_status },
      after: { verificationStatus: "resolved", roadReopened: change?.changed ?? false },
      reason: body.reason ?? null,
    });
    return { row: await fetchHazard(c, id), change, note };
  });
  deps.realtime.publish("hazard.verified", [rooms.admins, rooms.public], { entityId: id, status: "resolved", data: toHazard(row, false) });
  if (change) publishRoadChange(deps, change);
  return { hazard: toHazard(row, true), road: change ? roadSummary(change) : null, ...(note && { note }) };
}
