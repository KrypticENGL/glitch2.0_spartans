import type { z } from "zod";
import { withTransaction, type Queryable } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { notFound } from "../../lib/errors.js";
import { rooms } from "../../realtime/events.js";
import { writeAudit } from "../../services/audit.js";
import type { RoadStatus } from "../../types/enums.js";
import type { RoadListQuery, RoadStatusBody } from "./schemas.js";

interface RoadRow {
  id: number;
  name: string | null;
  road_type: string;
  status: RoadStatus;
  oneway: boolean;
  length_meters: number;
  travel_time_seconds: number;
  flood_risk: number;
  access_risk: number;
  travel_modes: string[];
  wheelchair_ok: boolean;
  source: string;
  updated_at: Date;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  total_count?: number;
}

const ROAD_COLUMNS = `e.id, e.name, e.road_type, e.status, e.oneway, e.length_meters, e.travel_time_seconds, e.flood_risk, e.access_risk,
  e.travel_modes, e.wheelchair_ok, e.source, e.updated_at, ST_AsGeoJSON(e.geom)::json AS geometry`;

const toRoad = (r: RoadRow) => ({
  id: r.id,
  name: r.name,
  roadType: r.road_type,
  status: r.status,
  oneway: r.oneway,
  lengthMeters: r.length_meters,
  travelTimeSeconds: r.travel_time_seconds,
  floodRisk: r.flood_risk,
  accessRisk: r.access_risk,
  travelModes: r.travel_modes,
  wheelchairOk: r.wheelchair_ok,
  source: r.source,
  updatedAt: r.updated_at.toISOString(),
  geometry: r.geometry,
});

export async function graphVersion(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ version: number }>(`SELECT version FROM graph_state`);
  return rows[0]!.version;
}

export async function listRoads(deps: AppDeps, q: z.infer<typeof RoadListQuery>) {
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (q.bbox) where.push(`e.geom && ST_MakeEnvelope(${p(q.bbox[0])}, ${p(q.bbox[1])}, ${p(q.bbox[2])}, ${p(q.bbox[3])}, 4326)`);
  if (q.status) where.push(`e.status = ANY(${p(q.status)}::road_status[])`);
  const { rows } = await deps.pool.query<RoadRow>(
    `SELECT ${ROAD_COLUMNS}, count(*) OVER() AS total_count FROM road_edges e
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY e.id LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`,
    params,
  );
  const version = await graphVersion(deps.pool);
  const total = rows[0]?.total_count ?? 0;
  if (q.format === "geojson") {
    return {
      type: "FeatureCollection" as const,
      graphVersion: version,
      page: q.page,
      pageSize: q.pageSize,
      total,
      features: rows.map((r) => {
        const { geometry, ...properties } = toRoad(r);
        return { type: "Feature" as const, id: r.id, geometry, properties };
      }),
    };
  }
  return { data: rows.map(toRoad), page: q.page, pageSize: q.pageSize, total, graphVersion: version };
}

async function fetchRoad(db: Queryable, id: number) {
  const { rows } = await db.query<RoadRow>(`SELECT ${ROAD_COLUMNS} FROM road_edges e WHERE e.id = $1`, [id]);
  if (!rows[0]) throw notFound("Road");
  return rows[0];
}

export async function getRoad(deps: AppDeps, id: number) {
  return toRoad(await fetchRoad(deps.pool, id));
}

export interface RoadChange {
  edgeId: number;
  previousStatus: RoadStatus;
  status: RoadStatus;
  changed: boolean;
  graphVersion: number;
  reason: string;
  invalidatedRoutes: { id: string; requestedBy: string | null }[];
}

/**
 * The single place a road's routing status changes. Must run inside the caller's transaction:
 * updates the edge, bumps graph_state.version, invalidates valid route records crossing the edge, writes the audit row.
 * Call publishRoadChange(deps, change) after COMMIT.
 */
export async function applyRoadStatusChange(
  c: Queryable,
  input: { edgeId: number; status: RoadStatus; reason: string; actorId: string | null; auditAction?: string },
): Promise<RoadChange> {
  const { rows } = await c.query<{ status: RoadStatus }>(`SELECT status FROM road_edges WHERE id = $1 FOR UPDATE`, [input.edgeId]);
  if (!rows[0]) throw notFound("Road");
  const previousStatus = rows[0].status;
  if (previousStatus === input.status) {
    return { edgeId: input.edgeId, previousStatus, status: input.status, changed: false, graphVersion: await graphVersion(c), reason: input.reason, invalidatedRoutes: [] };
  }
  await c.query(`UPDATE road_edges SET status = $2, updated_at = now() WHERE id = $1`, [input.edgeId, input.status]);
  const v = await c.query<{ version: number }>(
    `UPDATE graph_state SET version = version + 1, updated_at = now(), reason = $1 RETURNING version`,
    [`road ${input.edgeId}: ${previousStatus} -> ${input.status}`],
  );
  // Re-opening a road cannot make an existing route less safe, so only degradations invalidate routes.
  const invalidated =
    input.status === "open"
      ? { rows: [] as { id: string; requested_by: string | null }[] }
      : await c.query<{ id: string; requested_by: string | null }>(
          `UPDATE route_records SET status = 'invalidated', invalidated_at = now(), invalidation_reason = $2
           WHERE status = 'valid' AND edge_ids && ARRAY[$1]::bigint[] RETURNING id, requested_by`,
          [input.edgeId, `Road ${input.edgeId} is now ${input.status}: ${input.reason}`],
        );
  await writeAudit(c, {
    actorId: input.actorId,
    action: input.auditAction ?? "road.status.update",
    entityType: "road_edge",
    entityId: String(input.edgeId),
    before: { status: previousStatus },
    after: { status: input.status, graphVersion: v.rows[0]!.version, invalidatedRoutes: invalidated.rows.length },
    reason: input.reason,
  });
  return {
    edgeId: input.edgeId,
    previousStatus,
    status: input.status,
    changed: true,
    graphVersion: v.rows[0]!.version,
    reason: input.reason,
    invalidatedRoutes: invalidated.rows.map((r) => ({ id: r.id, requestedBy: r.requested_by })),
  };
}

/** Post-commit side effects of a road change: engine reload (best effort; the engine also self-checks the version) and events. */
export function publishRoadChange(deps: AppDeps, change: RoadChange): void {
  if (!change.changed) return;
  deps.routing.reload(change.graphVersion).catch((err: unknown) => deps.logger.warn({ err, graphVersion: change.graphVersion }, "routing engine reload failed"));
  deps.realtime.publish("road.status.updated", [rooms.admins, rooms.public], {
    entityId: String(change.edgeId),
    status: change.status,
    graphVersion: change.graphVersion,
    data: { edgeId: change.edgeId, previousStatus: change.previousStatus, status: change.status },
  });
  for (const route of change.invalidatedRoutes) {
    const target = [rooms.route(route.id), ...(route.requestedBy ? [rooms.user(route.requestedBy)] : [])];
    deps.realtime.publish("route.invalidated", target, {
      entityId: route.id,
      status: "invalidated",
      graphVersion: change.graphVersion,
      data: { routeRecordId: route.id, edgeId: change.edgeId, roadStatus: change.status, reason: change.reason },
    });
  }
}

export async function setRoadStatus(deps: AppDeps, id: number, body: z.infer<typeof RoadStatusBody>, actorId: string) {
  const change = await withTransaction(deps.pool, (c) => applyRoadStatusChange(c, { edgeId: id, status: body.status, reason: body.reason, actorId }));
  publishRoadChange(deps, change);
  return {
    road: await getRoad(deps, id),
    previousStatus: change.previousStatus,
    changed: change.changed,
    graphVersion: change.graphVersion,
    invalidatedRouteCount: change.invalidatedRoutes.length,
  };
}
