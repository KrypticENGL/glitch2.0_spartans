import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, login, makeTestApp } from "./helpers.js";

const { app, pool, events } = makeTestApp();
let citizen: string;
let admin: string;

async function fixtureShelter(code: string, total: number, occupancy = 0) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO shelters (code, name, location, total_capacity, current_occupancy) VALUES ($1, $1, ST_SetSRID(ST_MakePoint(85.95, 26.2), 4326), $2, $3) RETURNING id`,
    [code, total, occupancy],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  citizen = await login(app, "citizen@suraksha.demo");
  admin = await login(app, "admin@suraksha.demo");
});
afterAll(() => pool.end());

describe("GET /shelters", () => {
  it("filters by radius and sorts by distance", async () => {
    // Benta Stadium Camp is ~1.25 km from this point; Kadirabad ~2 km.
    const near = await request(app).get("/api/v1/shelters").query({ lat: 26.1542, lng: 85.896, radiusMeters: 1500 });
    expect(near.status).toBe(200);
    expect(near.body.data.map((s: { code: string }) => s.code)).toEqual(["shl-benta"]);
    expect(near.body.data[0].distanceMeters).toBeGreaterThan(1000);
    expect(near.body.data[0].distanceMeters).toBeLessThan(1500);

    const wide = await request(app).get("/api/v1/shelters").query({ lat: 26.1542, lng: 85.896, radiusMeters: 5000 });
    const d = wide.body.data.map((s: { distanceMeters: number }) => s.distanceMeters);
    expect(d.length).toBeGreaterThan(3);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(wide.body.data[0].location.type).toBe("Point");
  });

  it("filters available shelters and facilities", async () => {
    const res = await request(app).get("/api/v1/shelters").query({ available: "true", facility: "medical", pageSize: 50 });
    expect(res.status).toBe(200);
    for (const s of res.body.data) {
      expect(["open", "near_capacity"]).toContain(s.status);
      expect(s.availableCapacity).toBeGreaterThan(0);
      expect(s.facilities).toContain("medical");
    }
    expect(res.body.data.some((s: { code: string }) => s.code === "shl-allalpatti")).toBe(false); // full
  });

  it("rejects radius without a point", async () => {
    expect((await request(app).get("/api/v1/shelters").query({ radiusMeters: 100 })).status).toBe(400);
  });
});

describe("reservations", () => {
  it("allows exactly the capacity under parallel requests", async () => {
    const id = await fixtureShelter("shl-test-race", 10);
    const attempts = 8; // 8 x 2 people against 10 places → exactly 5 succeed
    const results = await Promise.all(
      Array.from({ length: attempts }, () => request(app).post(`/api/v1/shelters/${id}/reservations`).set(bearer(citizen)).send({ peopleCount: 2 })),
    );
    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(5);
    expect(rejected).toHaveLength(3);
    expect(rejected.every((r) => ["INSUFFICIENT_CAPACITY", "SHELTER_NOT_ACCEPTING"].includes(r.body.error.code))).toBe(true);

    const { rows } = await pool.query(`SELECT reserved_count, current_occupancy, total_capacity, operational_status FROM shelters WHERE id = $1`, [id]);
    expect(rows[0]).toMatchObject({ reserved_count: 10, current_occupancy: 0, total_capacity: 10, operational_status: "full" });
    const active = await pool.query(`SELECT count(*)::int AS n, sum(people_count)::int AS p FROM shelter_reservations WHERE shelter_id = $1 AND status = 'active'`, [id]);
    expect(active.rows[0]).toEqual({ n: 5, p: 10 });
    expect(events.ofType("shelter.occupancy.updated").filter((e) => e.input.entityId === id)).toHaveLength(5);
  });

  it("derives near_capacity at 90%", async () => {
    const id = await fixtureShelter("shl-test-90", 20, 10);
    const res = await request(app).post(`/api/v1/shelters/${id}/reservations`).set(bearer(citizen)).send({ peopleCount: 8 });
    expect(res.status).toBe(201);
    expect(res.body.occupancy).toMatchObject({ reservedCount: 8, availableCapacity: 2, status: "near_capacity" });
    expect(new Date(res.body.reservation.expiresAt).getTime() - Date.now()).toBeGreaterThan(119 * 60_000);
  });

  it("requires authentication", async () => {
    const id = await fixtureShelter("shl-test-anon", 5);
    expect((await request(app).post(`/api/v1/shelters/${id}/reservations`).send({ peopleCount: 1 })).status).toBe(401);
  });

  it("database CHECK rejects an over-capacity update directly", async () => {
    const id = await fixtureShelter("shl-test-check", 5, 3);
    await expect(pool.query(`UPDATE shelters SET reserved_count = 3 WHERE id = $1`, [id])).rejects.toMatchObject({ code: "23514", constraint: "occupancy_within_capacity" });
  });

  it("expired reservations release capacity", async () => {
    const id = await fixtureShelter("shl-test-expire", 4);
    const res = await request(app).post(`/api/v1/shelters/${id}/reservations`).set(bearer(citizen)).send({ peopleCount: 4 });
    expect(res.body.occupancy.status).toBe("full");
    await pool.query(`UPDATE shelter_reservations SET expires_at = now() - interval '1 minute' WHERE shelter_id = $1`, [id]);
    const again = await request(app).post(`/api/v1/shelters/${id}/reservations`).set(bearer(citizen)).send({ peopleCount: 3 });
    expect(again.status).toBe(201);
    expect(again.body.occupancy.reservedCount).toBe(3);
  });
});

describe("PATCH /shelters/:id", () => {
  it("lets admins update occupancy with audit and derived status", async () => {
    const id = await fixtureShelter("shl-test-patch", 100, 10);
    const res = await request(app).patch(`/api/v1/shelters/${id}`).set(bearer(admin)).send({ currentOccupancy: 95, reason: "headcount" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currentOccupancy: 95, status: "near_capacity" });
    const audit = await pool.query(`SELECT action, reason FROM audit_logs WHERE entity_id = $1`, [id]);
    expect(audit.rows).toEqual([{ action: "shelter.update", reason: "headcount" }]);

    const over = await request(app).patch(`/api/v1/shelters/${id}`).set(bearer(admin)).send({ currentOccupancy: 101 });
    expect(over.status).toBe(409);

    const closed = await request(app).patch(`/api/v1/shelters/${id}`).set(bearer(admin)).send({ status: "closed" });
    expect(closed.body.status).toBe("closed");
    const reserve = await request(app).post(`/api/v1/shelters/${id}/reservations`).set(bearer(citizen)).send({ peopleCount: 1 });
    expect(reserve.status).toBe(409);
    expect(reserve.body.error.code).toBe("SHELTER_NOT_ACCEPTING");
  });

  it("forbids citizens", async () => {
    const id = await fixtureShelter("shl-test-forbid", 10);
    expect((await request(app).patch(`/api/v1/shelters/${id}`).set(bearer(citizen)).send({ currentOccupancy: 1 })).status).toBe(403);
  });
});
