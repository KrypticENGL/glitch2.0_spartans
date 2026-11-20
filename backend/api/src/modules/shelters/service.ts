import type { z } from "zod";
import { withTransaction, type Queryable } from "../../db/pool.js";
import type { AppDeps } from "../../deps.js";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { rooms } from "../../realtime/events.js";
import { writeAudit } from "../../services/audit.js";
import type { ShelterStatus } from "../../types/enums.js";
import type { ReservationBody, ShelterListQuery, ShelterPatchBody } from "./schemas.js";

export const RESERVATION_TTL_MINUTES = 120;

interface ShelterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  location: { type: "Point"; coordinates: [number, number] };
  address: string | null;
  area: string | null;
  total_capacity: number;
  current_occupancy: number;
  reserved_count: number;
  operational_status: ShelterStatus;
  facilities: string[];
  accessible: boolean;
  accessibility_notes: string | null;
  contact_phone: string | null;
  source: string;
  updated_at: Date;
  distance_meters?: number | null;
  total_count?: number;
}

export const SHELTER_COLUMNS = `s.id, s.code, s.name, s.description, ST_AsGeoJSON(s.location)::json AS location, s.address, s.area,
  s.total_capacity, s.current_occupancy, s.reserved_count, s.operational_status, s.facilities, s.accessible,
  s.accessibility_notes, s.contact_phone, s.source, s.updated_at`;

const available = (r: Pick<ShelterRow, "total_capacity" | "current_occupancy" | "reserved_count">) =>
  Math.max(0, r.total_capacity - r.current_occupancy - r.reserved_count);
const pct = (r: Pick<ShelterRow, "total_capacity" | "current_occupancy" | "reserved_count">) =>
  r.total_capacity === 0 ? 100 : Math.round(((r.current_occupancy + r.reserved_count) / r.total_capacity) * 1000) / 10;

export const toOccupancy = (r: ShelterRow) => ({
  shelterId: r.id,
  totalCapacity: r.total_capacity,
  currentOccupancy: r.current_occupancy,
  reservedCount: r.reserved_count,
  availableCapacity: available(r),
  occupancyPercent: pct(r),
  status: r.operational_status,
  updatedAt: r.updated_at.toISOString(),
});

export const toShelter = (r: ShelterRow) => ({
  id: r.id,
  code: r.code,
  name: r.name,
  description: r.description,
  location: r.location,
  address: r.address,
  area: r.area,
  totalCapacity: r.total_capacity,
  currentOccupancy: r.current_occupancy,
  reservedCount: r.reserved_count,
  availableCapacity: available(r),
  occupancyPercent: pct(r),
  status: r.operational_status,
  facilities: r.facilities,
  accessible: r.accessible,
  accessibilityNotes: r.accessibility_notes,
  contactPhone: r.contact_phone,
  source: r.source,
  updatedAt: r.updated_at.toISOString(),
  ...(r.distance_meters != null && { distanceMeters: Math.round(r.distance_meters) }),
});

export async function listShelters(deps: AppDeps, q: z.infer<typeof ShelterListQuery>) {
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  let distance = "NULL::float8";
  if (q.lat !== undefined && q.lng !== undefined) {
    const point = `ST_SetSRID(ST_MakePoint(${p(q.lng)}, ${p(q.lat)}), 4326)::geography`;
    distance = `ST_Distance(s.location::geography, ${point})`;
    if (q.radiusMeters !== undefined) where.push(`ST_DWithin(s.location::geography, ${point}, ${p(q.radiusMeters)})`);
  }
  if (q.status) where.push(`s.operational_status = ANY(${p(q.status)}::shelter_status[])`);
  if (q.available === true) where.push(`s.operational_status IN ('open','near_capacity') AND s.total_capacity - s.current_occupancy - s.reserved_count > 0`);
  if (q.available === false) where.push(`NOT (s.operational_status IN ('open','near_capacity') AND s.total_capacity - s.current_occupancy - s.reserved_count > 0)`);
  if (q.facility) where.push(`s.facilities @> ${p(q.facility.split(",").map((f) => f.trim()).filter(Boolean))}::text[]`);
  if (q.accessible !== undefined) where.push(`s.accessible = ${p(q.accessible)}`);
  const sql = `SELECT ${SHELTER_COLUMNS}, ${distance} AS distance_meters, count(*) OVER() AS total_count
    FROM shelters s ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${q.lat !== undefined ? "distance_meters ASC," : ""} s.name ASC
    LIMIT ${p(q.pageSize)} OFFSET ${p((q.page - 1) * q.pageSize)}`;
  const { rows } = await deps.pool.query<ShelterRow>(sql, params);
  return { data: rows.map(toShelter), page: q.page, pageSize: q.pageSize, total: rows[0]?.total_count ?? 0 };
}

async function fetchShelter(db: Queryable, id: string, lock = false) {
  const { rows } = await db.query<ShelterRow>(`SELECT ${SHELTER_COLUMNS} FROM shelters s WHERE s.id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  if (!rows[0]) throw notFound("Shelter");
  return rows[0];
}

export async function getShelter(deps: AppDeps, id: string) {
  return toShelter(await fetchShelter(deps.pool, id));
}

export async function getOccupancy(deps: AppDeps, id: string) {
  return toOccupancy(await fetchShelter(deps.pool, id));
}

/**
 * Expires overdue active reservations and releases their capacity (status re-derived).
 * Returns the affected shelter rows. Runs inside the caller's transaction when given a client.
 */
export async function expireReservations(db: Queryable, shelterId: string | null = null) {
  const { rows } = await db.query<ShelterRow>(
    `WITH expired AS (
       UPDATE shelter_reservations SET status = 'expired', updated_at = now()
       WHERE status = 'active' AND expires_at < now() AND ($1::uuid IS NULL OR shelter_id = $1)
       RETURNING shelter_id, people_count),
     released AS (SELECT shelter_id, sum(people_count)::int AS n FROM expired GROUP BY shelter_id)
     UPDATE shelters s SET
       reserved_count = greatest(0, s.reserved_count - released.n),
       operational_status = shelter_derived_status(s.operational_status, s.total_capacity, s.current_occupancy + greatest(0, s.reserved_count - released.n)),
       updated_at = now()
     FROM released WHERE s.id = released.shelter_id
     RETURNING ${SHELTER_COLUMNS}`,
    [shelterId],
  );
  return rows;
}

function publishOccupancy(deps: AppDeps, row: ShelterRow) {
  deps.realtime.publish("shelter.occupancy.updated", [rooms.public, rooms.admins], {
    entityId: row.id,
    status: row.operational_status,
    data: { ...toOccupancy(row), code: row.code, name: row.name },
  });
}

export async function sweepExpiredReservations(deps: AppDeps) {
  const rows = await expireReservations(deps.pool);
  rows.forEach((r) => publishOccupancy(deps, r));
  return rows.length;
}

export async function patchShelter(deps: AppDeps, id: string, body: z.infer<typeof ShelterPatchBody>, actorId: string) {
  const row = await withTransaction(deps.pool, async (c) => {
    const before = await fetchShelter(c, id, true);
    const total = body.totalCapacity ?? before.total_capacity;
    const occupancy = body.currentOccupancy ?? before.current_occupancy;
    const intent: ShelterStatus = body.status === "closed" ? "closed" : body.status === "open" ? "open" : before.operational_status;
    if (total < occupancy + before.reserved_count) {
      throw conflict("CAPACITY_EXCEEDED", "Occupancy plus active reservations would exceed total capacity", {
        totalCapacity: total,
        currentOccupancy: occupancy,
        reservedCount: before.reserved_count,
      });
    }
    await c.query(
      `UPDATE shelters SET total_capacity = $2, current_occupancy = $3,
         operational_status = shelter_derived_status($4::shelter_status, $2, $3 + reserved_count), updated_at = now()
       WHERE id = $1`,
      [id, total, occupancy, intent],
    );
    const after = await fetchShelter(c, id);
    await writeAudit(c, {
      actorId,
      action: "shelter.update",
      entityType: "shelter",
      entityId: id,
      before: toOccupancy(before),
      after: toOccupancy(after),
      reason: body.reason ?? null,
    });
    return after;
  });
  publishOccupancy(deps, row);
  return toShelter(row);
}

export async function reserve(deps: AppDeps, shelterId: string, body: z.infer<typeof ReservationBody>, requesterId: string) {
  const result = await withTransaction(deps.pool, async (c) => {
    await expireReservations(c, shelterId);
    const s = await fetchShelter(c, shelterId, true);
    if (s.operational_status !== "open" && s.operational_status !== "near_capacity") {
      throw conflict("SHELTER_NOT_ACCEPTING", `Shelter is ${s.operational_status}`, { status: s.operational_status });
    }
    if (available(s) < body.peopleCount) {
      throw conflict("INSUFFICIENT_CAPACITY", "Not enough free capacity at this shelter", { availableCapacity: available(s), requested: body.peopleCount });
    }
    if (body.routeRecordId) {
      const route = await c.query(`SELECT 1 FROM route_records WHERE id = $1 AND destination_shelter_id = $2`, [body.routeRecordId, shelterId]);
      if (!route.rowCount) throw unprocessable("ROUTE_SHELTER_MISMATCH", "routeRecordId does not lead to this shelter");
    }
    await c.query(
      `UPDATE shelters SET reserved_count = reserved_count + $2,
         operational_status = shelter_derived_status(operational_status, total_capacity, current_occupancy + reserved_count + $2),
         updated_at = now()
       WHERE id = $1`,
      [shelterId, body.peopleCount],
    );
    const { rows } = await c.query<{ id: string; shelter_id: string; people_count: number; status: "active"; expires_at: Date; created_at: Date }>(
      `INSERT INTO shelter_reservations (shelter_id, requester_id, route_record_id, people_count, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5)) RETURNING *`,
      [shelterId, requesterId, body.routeRecordId ?? null, body.peopleCount, RESERVATION_TTL_MINUTES],
    );
    return { reservation: rows[0]!, shelter: await fetchShelter(c, shelterId) };
  });
  publishOccupancy(deps, result.shelter);
  const r = result.reservation;
  return {
    reservation: { id: r.id, shelterId: r.shelter_id, peopleCount: r.people_count, status: r.status, expiresAt: r.expires_at.toISOString(), createdAt: r.created_at.toISOString() },
    occupancy: toOccupancy(result.shelter),
  };
}
