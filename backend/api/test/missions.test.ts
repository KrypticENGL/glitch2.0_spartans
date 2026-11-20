import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOS_BODY, bearer, login, makeTestApp, teamId } from "./helpers.js";

const { app, pool, events } = makeTestApp();
let admin: string;
let civResponder: string;
let ndrfResponder: string;
let civTeam: string;
let medTeam: string;

async function newSos() {
  const res = await request(app).post("/api/v1/sos").send(SOS_BODY);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const availability = async (id: string) =>
  (await pool.query<{ availability: string }>(`SELECT availability FROM rescue_teams WHERE id = $1`, [id])).rows[0]!.availability;
const sosStatus = async (id: string) => (await pool.query<{ status: string }>(`SELECT status FROM sos_requests WHERE id = $1`, [id])).rows[0]!.status;

beforeAll(async () => {
  admin = await login(app, "admin@suraksha.demo");
  civResponder = await login(app, "civ-5@suraksha.demo");
  ndrfResponder = await login(app, "ndrf-1@suraksha.demo");
  civTeam = await teamId(pool, "team-civ-5");
  medTeam = await teamId(pool, "team-med-4");
});
afterAll(() => pool.end());

describe("missions", () => {
  it("assigns, walks the state machine, and keeps incident/team status in sync", async () => {
    const sos = await newSos();
    expect(await availability(civTeam)).toBe("available");

    const created = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: civTeam, notes: "go" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: "assigned", rescueTeamId: civTeam, sosRequestId: sos });
    expect(created.body.code).toMatch(/^MSN-\d{6}$/);
    expect(await sosStatus(sos)).toBe("assigned");
    expect(await availability(civTeam)).toBe("on_mission");
    const assignedEvt = events.ofType("mission.assigned").at(-1)!;
    expect(assignedEvt.rooms).toEqual(["admins", `team:${civTeam}`]);

    const id = created.body.id as string;
    const skip = await request(app).patch(`/api/v1/missions/${id}/status`).set(bearer(civResponder)).send({ status: "on_site" });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe("INVALID_TRANSITION");

    const other = await request(app).patch(`/api/v1/missions/${id}/status`).set(bearer(ndrfResponder)).send({ status: "accepted" });
    expect(other.status).toBe(403);

    for (const [status, incident] of [
      ["accepted", "assigned"],
      ["en_route", "en_route"],
      ["on_site", "on_site"],
      ["completed", "resolved"],
    ] as const) {
      const res = await request(app).patch(`/api/v1/missions/${id}/status`).set(bearer(civResponder)).send({ status });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
      expect(await sosStatus(sos)).toBe(incident);
    }
    const done = await pool.query(`SELECT completed_at FROM rescue_missions WHERE id = $1`, [id]);
    expect(done.rows[0].completed_at).not.toBeNull();
    expect(await availability(civTeam)).toBe("available");

    const after = await request(app).patch(`/api/v1/missions/${id}/status`).set(bearer(admin)).send({ status: "cancelled" });
    expect(after.status).toBe(409);

    const closed = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: civTeam });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("INCIDENT_CLOSED");
  });

  it("keeps exactly one active mission per SOS when reassigning", async () => {
    const sos = await newSos();
    const first = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: civTeam });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: medTeam });
    expect(second.status).toBe(201);

    const { rows } = await pool.query(`SELECT id, status FROM rescue_missions WHERE sos_request_id = $1 ORDER BY assigned_at`, [sos]);
    expect(rows.map((r) => r.status)).toEqual(["cancelled", "assigned"]);
    expect(await availability(civTeam)).toBe("available");
    expect(await availability(medTeam)).toBe("on_mission");

    // The partial unique index is the last line of defence.
    await expect(
      pool.query(`INSERT INTO rescue_missions (code, sos_request_id, rescue_team_id) VALUES ('MSN-DUP-TEST', $1, $2)`, [sos, civTeam]),
    ).rejects.toMatchObject({ code: "23505", constraint: "missions_one_active_per_sos" });

    const same = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: medTeam });
    expect(same.status).toBe(409);

    // Cancelling returns the incident to the queue.
    const cancel = await request(app).patch(`/api/v1/missions/${second.body.id}/status`).set(bearer(admin)).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect(await sosStatus(sos)).toBe("new");
  });

  it("team stays on_mission while it has another active mission", async () => {
    const a = await newSos();
    const b = await newSos();
    const m1 = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: a, rescueTeamId: civTeam });
    const m2 = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: b, rescueTeamId: civTeam });
    expect([m1.status, m2.status]).toEqual([201, 201]);
    await request(app).patch(`/api/v1/missions/${m1.body.id}/status`).set(bearer(admin)).send({ status: "cancelled" });
    expect(await availability(civTeam)).toBe("on_mission");
    await request(app).patch(`/api/v1/missions/${m2.body.id}/status`).set(bearer(admin)).send({ status: "cancelled" });
    expect(await availability(civTeam)).toBe("available");
  });

  it("closing an incident cancels its active mission", async () => {
    const sos = await newSos();
    const m = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos, rescueTeamId: civTeam });
    const res = await request(app).patch(`/api/v1/incidents/${sos}/status`).set(bearer(admin)).send({ status: "cancelled", reason: "duplicate report" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "cancelled", activeMission: null });
    const { rows } = await pool.query(`SELECT status FROM rescue_missions WHERE id = $1`, [m.body.id]);
    expect(rows[0].status).toBe("cancelled");
    expect(await availability(civTeam)).toBe("available");
  });

  it("responders only see their own team's missions", async () => {
    const res = await request(app).get("/api/v1/missions").set(bearer(ndrfResponder));
    expect(res.status).toBe(200);
    const ndrf = await teamId(pool, "team-ndrf-1");
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((m: { rescueTeamId: string }) => m.rescueTeamId === ndrf)).toBe(true);
    const citizen = await login(app, "citizen@suraksha.demo");
    expect((await request(app).get("/api/v1/missions").set(bearer(citizen))).status).toBe(403);
    expect((await request(app).post("/api/v1/missions").set(bearer(ndrfResponder)).send({ sosRequestId: await newSos(), rescueTeamId: ndrf })).status).toBe(403);
  });
});
