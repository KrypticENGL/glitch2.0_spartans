import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PRIORITY_CONFIG, computePriority, resolvePriorityConfig, type PriorityInput } from "../src/modules/incidents/priority.js";
import { SOS_BODY, bearer, login, makeTestApp } from "./helpers.js";

const { app, pool, events } = makeTestApp();
let admin: string;
let citizen: string;

beforeAll(async () => {
  admin = await login(app, "admin@suraksha.demo");
  citizen = await login(app, "citizen@suraksha.demo");
});
afterAll(() => pool.end());

const base: PriorityInput = {
  emergencyType: "other",
  peopleCount: 1,
  lifeThreatening: false,
  medicalNeeded: false,
  trapped: false,
  childrenCount: 0,
  elderlyCount: 0,
  disabledCount: 0,
  nearbyVerifiedHazards: 0,
  waitingMinutes: 0,
};

describe("priority rules", () => {
  it("scores nothing that was not reported", () => {
    expect(computePriority(base)).toMatchObject({ score: 0, level: "low", breakdown: [] });
  });

  it("is deterministic, explains every point, and maps thresholds", () => {
    const input: PriorityInput = { ...base, emergencyType: "stranded", peopleCount: 14, lifeThreatening: true, trapped: true, childrenCount: 4, elderlyCount: 2, waitingMinutes: 95 };
    const a = computePriority(input);
    expect(a).toEqual(computePriority(input));
    expect(a.score).toBe(a.breakdown.reduce((s, f) => s + f.points, 0));
    expect(a.breakdown.map((f) => f.factor)).toEqual(["life_threatening", "trapped", "people_count", "children", "elderly", "emergency_type", "waiting_time"]);
    expect(a.breakdown.find((f) => f.factor === "people_count")!.points).toBe(12); // capped log scale
    expect(a.level).toBe("critical");
    expect(computePriority({ ...base, medicalNeeded: true, emergencyType: "medical", peopleCount: 4, elderlyCount: 1 }).level).toBe("medium"); // 15+8+5+8 = 36
    expect(computePriority({ ...base, lifeThreatening: true, medicalNeeded: true }).level).toBe("high"); // 45
  });

  it("caps the score at 100 and supports config overrides", () => {
    const all: PriorityInput = { ...base, emergencyType: "structure_collapse", peopleCount: 500, lifeThreatening: true, medicalNeeded: true, trapped: true, childrenCount: 1, elderlyCount: 1, disabledCount: 1, nearbyVerifiedHazards: 9, waitingMinutes: 600 };
    expect(computePriority(all).score).toBe(100);
    const cfg = resolvePriorityConfig(JSON.stringify({ thresholds: { critical: 90 }, lifeThreatening: 50 }));
    expect(cfg.medicalNeeded).toBe(DEFAULT_PRIORITY_CONFIG.medicalNeeded);
    expect(computePriority({ ...base, lifeThreatening: true }, cfg)).toMatchObject({ score: 50, level: "high" });
    expect(() => resolvePriorityConfig(JSON.stringify({ bogus: 1 }))).toThrow();
    expect(() => resolvePriorityConfig(JSON.stringify({ thresholds: { medium: 99 } }))).toThrow();
  });
});

describe("POST /sos", () => {
  it("creates an SOS with a code and a priority breakdown, notifying admins only", async () => {
    const res = await request(app)
      .post("/api/v1/sos")
      .send({ ...SOS_BODY, emergencyType: "medical", medicalNeeded: true, lifeThreatening: true, peopleCount: 2, notes: "Chest pain" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^SOS-\d{6}$/);
    expect(res.body).toMatchObject({ status: "new", priorityOverridden: false, requesterId: null });
    expect(res.body.priority).toBe(res.body.suggestedPriority);
    expect(res.body.priorityScore).toBe(res.body.priorityBreakdown.reduce((s: number, f: { points: number }) => s + f.points, 0));
    expect(res.body.priorityBreakdown.map((f: { factor: string }) => f.factor)).toEqual(expect.arrayContaining(["life_threatening", "medical", "people_count", "emergency_type"]));
    const evt = events.ofType("sos.created").at(-1)!;
    expect(evt.rooms).toEqual(["admins"]);
    expect(evt.input.entityId).toBe(res.body.id);
  });

  it("counts nearby verified hazards (PostGIS, 300 m)", async () => {
    // Seeded verified hazard on edge 49 at (85.891261, 26.148669)
    const res = await request(app).post("/api/v1/sos").send({ ...SOS_BODY, location: { latitude: 26.1489, longitude: 85.8914 } });
    const factor = res.body.priorityBreakdown.find((f: { factor: string }) => f.factor === "nearby_hazards");
    expect(factor.points).toBeGreaterThan(0);
  });

  it("is idempotent with Idempotency-Key", async () => {
    const key = `idem-${Date.now()}`;
    const first = await request(app).post("/api/v1/sos").set(bearer(citizen)).set("Idempotency-Key", key).send(SOS_BODY);
    const second = await request(app).post("/api/v1/sos").set(bearer(citizen)).set("Idempotency-Key", key).send(SOS_BODY);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM sos_requests WHERE idempotency_key = $1`, [key]);
    expect(rows[0].n).toBe(1);

    // Another submitter cannot replay someone else's key.
    const stranger = await request(app).post("/api/v1/sos").set("Idempotency-Key", key).send(SOS_BODY);
    expect(stranger.status).toBe(409);
    expect((await request(app).post("/api/v1/sos").set("Idempotency-Key", "bad key!").send(SOS_BODY)).status).toBe(400);
  });

  it("lets only the requester or staff read an SOS", async () => {
    const mine = await request(app).post("/api/v1/sos").set(bearer(citizen)).send(SOS_BODY);
    expect((await request(app).get(`/api/v1/sos/${mine.body.id}`).set(bearer(citizen))).status).toBe(200);
    expect((await request(app).get(`/api/v1/sos/${mine.body.id}`).set(bearer(admin))).status).toBe(200);
    expect((await request(app).get(`/api/v1/sos/${mine.body.id}`)).status).toBe(401);
    const other = await request(app).post("/api/v1/auth/register").send({ name: "Other", email: `other-${Date.now()}@example.com`, password: "password-123" });
    expect((await request(app).get(`/api/v1/sos/${mine.body.id}`).set(bearer(other.body.token))).status).toBe(404);
  });
});

describe("incidents", () => {
  it("lists by priority then age", async () => {
    const res = await request(app).get("/api/v1/incidents").set(bearer(admin)).query({ pageSize: 100 });
    expect(res.status).toBe(200);
    const order = ["critical", "high", "medium", "low"];
    const ranks = res.body.data.map((i: { priority: string }) => order.indexOf(i.priority));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const filtered = await request(app).get("/api/v1/incidents").set(bearer(admin)).query({ priority: "critical" });
    expect(filtered.body.data.every((i: { priority: string }) => i.priority === "critical")).toBe(true);
    expect(filtered.body.data.some((i: { code: string }) => i.code === "INC-1041")).toBe(true);
  });

  it("admin override keeps the suggestion and writes an audit row", async () => {
    const sos = await request(app).post("/api/v1/sos").send(SOS_BODY);
    const res = await request(app).patch(`/api/v1/incidents/${sos.body.id}/priority`).set(bearer(admin)).send({ priority: "critical", reason: "Caller reports rising water" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ priority: "critical", priorityOverridden: true, suggestedPriority: sos.body.suggestedPriority });
    const audit = await pool.query(`SELECT action, reason, after FROM audit_logs WHERE entity_id = $1 AND action = 'incident.priority.override'`, [sos.body.id]);
    expect(audit.rows[0]).toMatchObject({ reason: "Caller reports rising water", after: { priority: "critical" } });

    const missingReason = await request(app).patch(`/api/v1/incidents/${sos.body.id}/priority`).set(bearer(admin)).send({ priority: "low" });
    expect(missingReason.status).toBe(400);

    // Re-evaluation refreshes the suggestion but keeps the override.
    await pool.query(`UPDATE sos_requests SET created_at = now() - interval '200 minutes' WHERE id = $1`, [sos.body.id]);
    const re = await request(app).post(`/api/v1/incidents/${sos.body.id}/reevaluate`).set(bearer(admin));
    expect(re.body.priority).toBe("critical");
    expect(re.body.priorityBreakdown.find((f: { factor: string }) => f.factor === "waiting_time").points).toBe(10);
  });
});
