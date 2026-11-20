import type { z } from "zod";
import { withTransaction } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { notFound } from "../../lib/errors.js";
import type { RouteRecordStatus } from "../../types/enums.js";
import { toPublicRoutingError, type EngineRoute, type EngineShelter } from "../../services/routing-client.js";
import { graphVersion } from "../roads/service.js";
import type { RouteEvaluateBody } from "./schemas.js";

export const ROUTE_RECORD_TTL_MINUTES = 30;
export const SOURCE_CLASSIFICATION = "OSM road network; simulated hazards/shelters";
export const DISCLAIMER =
  "Decision support only. Road, flood and shelter data in this demo are partly simulated; risk scores are relative rankings, not probabilities of safety. Follow instructions from local authorities and rescue personnel.";

interface ShelterRow {
  id: string;
  code: string;
  name: string;
  longitude: number;
  latitude: number;
  total_capacity: number;
  available: number;
  operational_status: string;
  accessible: boolean;
}

export async function evaluateRoutes(deps: AppDeps, body: z.infer<typeof RouteEvaluateBody>, requesterId: string | null) {
  const [version, shelters] = await Promise.all([
    graphVersion(deps.pool),
    deps.pool.query<ShelterRow>(
      `SELECT id, code, name, ST_X(location) AS longitude, ST_Y(location) AS latitude, total_capacity,
         greatest(0, total_capacity - current_occupancy - reserved_count) AS available, operational_status, accessible
       FROM shelters ORDER BY code`,
    ),
  ]);
  const engineShelters: EngineShelter[] = shelters.rows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    longitude: s.longitude,
    latitude: s.latitude,
    totalCapacity: s.total_capacity,
    availableCapacity: s.available,
    status: s.operational_status,
    accessible: s.accessible,
  }));

  let result;
  try {
    result = await deps.routing.evaluate(
      {
        graphVersion: version,
        origin: body.origin,
        peopleCount: body.peopleCount,
        travelMode: body.travelMode,
        needsAccessibleRoute: body.needsAccessibleRoute,
        maxAlternatives: body.maxAlternatives,
        ...(body.population && { population: body.population }),
        shelters: engineShelters,
      },
      () => graphVersion(deps.pool),
    );
  } catch (err) {
    deps.logger.warn({ err }, "route evaluation failed");
    throw toPublicRoutingError(err);
  }

  const routes = [result.recommended, ...(result.alternatives ?? [])].filter((r): r is EngineRoute => r !== null);
  const persisted = await withTransaction(deps.pool, async (c) => {
    const out: { routeId: string; recordId: string; expiresAt: Date }[] = [];
    for (const route of routes) {
      const { rows } = await c.query<{ id: string; expires_at: Date }>(
        `INSERT INTO route_records (requested_by, origin, destination_shelter_id, geometry, edge_ids, risk_score, risk_breakdown,
           people_count, travel_mode, graph_version, expires_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6::bigint[], $7, $8, $9, $10, $11,
           now() + make_interval(mins => $12))
         RETURNING id, expires_at`,
        [
          requesterId,
          body.origin.longitude,
          body.origin.latitude,
          route.shelterId,
          JSON.stringify(route.geometry),
          route.edgeIds,
          route.riskScore,
          JSON.stringify({ breakdown: route.riskBreakdown, weighted: route.weightedContributions ?? null }),
          body.peopleCount,
          body.travelMode,
          result.graphVersion,
          ROUTE_RECORD_TTL_MINUTES,
        ],
      );
      out.push({ routeId: route.id, recordId: rows[0]!.id, expiresAt: rows[0]!.expires_at });
    }
    return out;
  });

  let i = 0;
  const enrich = (r: EngineRoute) => ({ routeRecordId: persisted[i++]!.recordId, ...r });
  const recommended = result.recommended ? enrich(result.recommended) : null;
  const alternatives = (result.alternatives ?? []).map(enrich);
  return {
    ...result,
    recommended,
    alternatives,
    routeRecordExpiresAt: persisted[0]?.expiresAt.toISOString() ?? null,
    sourceClassification: SOURCE_CLASSIFICATION,
    disclaimer: DISCLAIMER,
  };
}

interface RouteRecordRow {
  id: string;
  status: RouteRecordStatus;
  expired: boolean;
  origin: { type: "Point"; coordinates: [number, number] };
  destination_shelter_id: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  edge_ids: number[];
  risk_score: number;
  risk_breakdown: Record<string, unknown>;
  people_count: number;
  travel_mode: string;
  graph_version: number;
  current_graph_version: number;
  calculated_at: Date;
  expires_at: Date;
  invalidated_at: Date | null;
  invalidation_reason: string | null;
}

export async function getRouteRecord(deps: AppDeps, id: string) {
  const { rows } = await deps.pool.query<RouteRecordRow>(
    `SELECT r.id, r.status, (r.expires_at < now()) AS expired, ST_AsGeoJSON(r.origin)::json AS origin, r.destination_shelter_id,
       ST_AsGeoJSON(r.geometry)::json AS geometry, r.edge_ids, r.risk_score, r.risk_breakdown, r.people_count, r.travel_mode,
       r.graph_version, g.version AS current_graph_version, r.calculated_at, r.expires_at, r.invalidated_at, r.invalidation_reason
     FROM route_records r CROSS JOIN graph_state g WHERE r.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) throw notFound("Route record");
  return {
    id: r.id,
    // Expiry is time-based, so it is derived on read rather than requiring a sweeper.
    status: r.status === "valid" && r.expired ? "expired" : r.status,
    origin: r.origin,
    destinationShelterId: r.destination_shelter_id,
    geometry: r.geometry,
    edgeIds: r.edge_ids,
    riskScore: r.risk_score,
    riskBreakdown: r.risk_breakdown,
    peopleCount: r.people_count,
    travelMode: r.travel_mode,
    graphVersion: r.graph_version,
    currentGraphVersion: r.current_graph_version,
    calculatedAt: r.calculated_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    invalidatedAt: r.invalidated_at?.toISOString() ?? null,
    invalidationReason: r.invalidation_reason,
  };
}
