import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, login, makeTestApp } from "./helpers.js";

const { app, pool, events } = makeTestApp();
let admin: string;
let citizen: string;
let citizenId: string;

const version = async () => (await pool.query<{ version: number }>(`SELECT version FROM graph_state`)).rows[0]!.version;
const roadStatus = async (id: number) => (await pool.query<{ status: string }>(`SELECT status FROM road_edges WHERE id = $1`, [id])).rows[0]!.status;

/** An open edge with its midpoint, for hazard reports that snap onto it. */
async function openEdge(offset: number) {
  const { rows } = await pool.query<{ id: number; lon: number; lat: number }>(
    `SELECT id, ST_X(ST_LineInterpolatePoint(geom, 0.5)) AS lon, ST_Y(ST_LineInterpolatePoint(geom, 0.5)) AS lat
     FROM road_edges WHERE status = 'open' AND length_meters > 80 ORDER BY id OFFSET $1 LIMIT 1`,
    [offset],
  );
  return rows[0]!;
}

async function routeFixture(edgeIds: number[], requestedBy: string | null = null) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO route_records (requested_by, origin, destination_shelter_id, geometry, edge_ids, risk_score, risk_breakdown, people_count, travel_mode, graph_version, expires_at)
     SELECT $2, ST_SetSRID(ST_MakePoint(85.896, 26.154), 4326), (SELECT id FROM shelters WHERE code = 'shl-benta'),
       ST_GeomFromText('LINESTRING(85.896 26.154, 85.9 26.16)', 4326), $1::bigint[], 10, '{}', 2, 'walking', (SELECT version FROM graph_state), now() + interval '30 minutes'
     RETURNING id`,
    [edgeIds, requestedBy],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  admin = await login(app, "admin@suraksha.demo");
  citizen = await login(app, "citizen@suraksha.demo");
  citizenId = (await request(app).get("/api/v1/auth/me").set(bearer(citizen))).body.id;
});
afterAll(() => pool.end());

describe("PATCH /roads/:id/status", () => {
  it("bumps the graph version, invalidates overlapping routes only, audits and emits", async () => {
    const edge = await openEdge(0);
    const other = await openEdge(1);
    const hit = await routeFixture([other.id, edge.id], citizenId);
    const miss = await routeFixture([other.id]);
    const v0 = await version();

    const res = await request(app).patch(`/api/v1/roads/${edge.id}/status`).set(bearer(admin)).send({ status: "blocked", reason: "bridge washed out" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ previousStatus: "open", changed: true, graphVersion: v0 + 1, invalidatedRouteCount: 1 });
    expect(res.body.road.status).toBe("blocked");
    expect(await version()).toBe(v0 + 1);

    const routes = await pool.query(`SELECT id, status, invalidation_reason FROM route_records WHERE id = ANY($1::uuid[])`, [[hit, miss]]);
    const byId = Object.fromEntries(routes.rows.map((r) => [r.id, r]));
    expect(byId[hit].status).toBe("invalidated");
    expect(byId[hit].invalidation_reason).toContain("bridge washed out");
    expect(byId[miss].status).toBe("valid");

    const audit = await pool.query(`SELECT action, before, after FROM audit_logs WHERE entity_type = 'road_edge' AND entity_id = $1`, [String(edge.id)]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "road.status.update", before: { status: "open" }, after: { status: "blocked" } });

    const roadEvt = events.ofType("road.status.updated").at(-1)!;
    expect(roadEvt.rooms).toEqual(["admins", "public"]);
    expect(roadEvt.input.graphVersion).toBe(v0 + 1);
    const inv = events.ofType("route.invalidated").at(-1)!;
    expect(inv.rooms).toEqual([`route:${hit}`, `user:${citizenId}`]);

    const record = await request(app).get(`/api/v1/routes/${hit}`);
    expect(record.body.status).toBe("invalidated");

    // No-op change does not bump the version.
    const same = await request(app).patch(`/api/v1/roads/${edge.id}/status`).set(bearer(admin)).send({ status: "blocked", reason: "still blocked" });
    expect(same.body.changed).toBe(false);
    expect(await version()).toBe(v0 + 1);
  });

  it("validates input", async () => {
    expect((await request(app).patch(`/api/v1/roads/abc/status`).set(bearer(admin)).send({ status: "blocked", reason: "x y z" })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/roads/1/status`).set(bearer(admin)).send({ status: "flooded", reason: "x y z" })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/roads/999999999/status`).set(bearer(admin)).send({ status: "blocked", reason: "x y z" })).status).toBe(404);
  });
});

describe("hazards", () => {
  it("citizen reports stay unverified, snap to a road, and never change road status", async () => {
    const edge = await openEdge(2);
    const v0 = await version();
    const res = await request(app)
      .post("/api/v1/hazards")
      .set(bearer(citizen))
      .send({ location: { latitude: edge.lat, longitude: edge.lon }, hazardType: "waterlogging", severity: "severe", description: "Knee-deep water" });
    expect(res.status).toBe(201);
    expect(res.body.hazard).toMatchObject({ verificationStatus: "unverified", source: "citizen", roadEdgeId: edge.id, appliedRoadStatus: null });
    expect(res.body.road).toBeNull();
    expect(await roadStatus(edge.id)).toBe("open");
    expect(await version()).toBe(v0);
    expect(events.ofType("hazard.reported").at(-1)!.rooms).toEqual(["admins"]);

    const sneaky = await request(app)
      .post("/api/v1/hazards")
      .set(bearer(citizen))
      .send({ location: { latitude: edge.lat, longitude: edge.lon }, hazardType: "flooding", severity: "severe", description: "x".repeat(10), verified: true, appliedRoadStatus: "blocked" });
    expect(sneaky.status).toBe(403);

    // Unverified reports are hidden from the public list.
    const pub = await request(app).get("/api/v1/hazards").query({ pageSize: 100 });
    expect(pub.body.data.every((h: { verificationStatus: string }) => h.verificationStatus === "verified")).toBe(true);
    expect((await request(app).get(`/api/v1/hazards/${res.body.hazard.id}`)).status).toBe(404);
  });

  it("verification applies the road status in one transaction and enforces transitions", async () => {
    const edge = await openEdge(3);
    const report = await request(app)
      .post("/api/v1/hazards")
      .send({ location: { latitude: edge.lat, longitude: edge.lon }, hazardType: "road_damage", severity: "severe", description: "Road caved in" });
    expect(report.status).toBe(201); // anonymous allowed
    const id = report.body.hazard.id as string;
    const route = await routeFixture([edge.id]);
    const v0 = await version();

    expect((await request(app).patch(`/api/v1/hazards/${id}/verify`).set(bearer(citizen)).send({ decision: "verified" })).status).toBe(403);

    const res = await request(app).patch(`/api/v1/hazards/${id}/verify`).set(bearer(admin)).send({ decision: "verified", appliedRoadStatus: "blocked" });
    expect(res.status).toBe(200);
    expect(res.body.hazard).toMatchObject({ verificationStatus: "verified", appliedRoadStatus: "blocked" });
    expect(res.body.road).toMatchObject({ edgeId: edge.id, status: "blocked", graphVersion: v0 + 1, invalidatedRouteCount: 1 });
    expect(await roadStatus(edge.id)).toBe("blocked");
    expect((await pool.query(`SELECT status FROM route_records WHERE id = $1`, [route])).rows[0].status).toBe("invalidated");

    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id = ANY($1) ORDER BY id`, [[id, String(edge.id)]]);
    expect(audit.rows.map((r) => r.action)).toEqual(["hazard.report", "hazard.road_status.apply", "hazard.verify"]);
    expect(events.ofType("hazard.verified").at(-1)!.rooms).toEqual(["admins", "public"]);

    const again = await request(app).patch(`/api/v1/hazards/${id}/verify`).set(bearer(admin)).send({ decision: "rejected" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");

    // Resolving re-opens the road (no other verified hazard on it).
    const resolved = await request(app).patch(`/api/v1/hazards/${id}/status`).set(bearer(admin)).send({ status: "resolved", reopenRoad: true });
    expect(resolved.status).toBe(200);
    expect(resolved.body.hazard.verificationStatus).toBe("resolved");
    expect(resolved.body.road).toMatchObject({ status: "open", graphVersion: v0 + 2 });
    expect(await roadStatus(edge.id)).toBe("open");
  });

  it("rejection has no road effect", async () => {
    const edge = await openEdge(4);
    const report = await request(app)
      .post("/api/v1/hazards")
      .set(bearer(citizen))
      .send({ location: { latitude: edge.lat, longitude: edge.lon }, hazardType: "fallen_tree", severity: "low", description: "Small branch" });
    const v0 = await version();
    const res = await request(app).patch(`/api/v1/hazards/${report.body.hazard.id}/verify`).set(bearer(admin)).send({ decision: "rejected" });
    expect(res.status).toBe(200);
    expect(res.body.hazard.verificationStatus).toBe("rejected");
    expect(res.body.road).toBeNull();
    expect(await version()).toBe(v0);
    expect(await roadStatus(edge.id)).toBe("open");
    const bad = await request(app).patch(`/api/v1/hazards/${report.body.hazard.id}/status`).set(bearer(admin)).send({ status: "resolved" });
    expect(bad.status).toBe(409);
  });
});
