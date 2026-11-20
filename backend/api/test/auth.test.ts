import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { bearer, login, makeTestApp } from "./helpers.js";

const { app, pool } = makeTestApp();
afterAll(() => pool.end());

describe("validation and error shape", () => {
  it("returns 400 VALIDATION_ERROR with details and a request id", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toBeTypeOf("string");
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "email" })]));
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("rejects malformed JSON with INVALID_JSON", async () => {
    const res = await request(app).post("/api/v1/auth/login").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("rejects unknown fields (strict bodies)", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({ name: "X", email: "x@example.com", password: "password123", role: "admin" });
    expect(res.status).toBe(400);
  });

  it("rejects coordinates outside Bihar", async () => {
    const res = await request(app).post("/api/v1/sos").send({ location: { latitude: 28.7, longitude: 77.1 }, emergencyType: "other", peopleCount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain("location.latitude");
  });
});

describe("auth", () => {
  it("registers a citizen, logs in, and reads /me", async () => {
    const email = `new-${Date.now()}@example.com`;
    const reg = await request(app).post("/api/v1/auth/register").send({ name: "New Citizen", email, password: "correct horse battery" });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email, role: "citizen" });
    expect(reg.body.user).not.toHaveProperty("passwordHash");

    const dup = await request(app).post("/api/v1/auth/register").send({ name: "Dup", email, password: "correct horse battery" });
    expect(dup.status).toBe(409);

    const token = await login(app, email, "correct horse battery");
    const me = await request(app).get("/api/v1/auth/me").set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("logs in a seeded admin", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "admin@suraksha.demo", password: "suraksha-demo" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("admin");
    expect(res.body.token).toBeTypeOf("string");
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "admin@suraksha.demo", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 without a token and with a forged token", async () => {
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/incidents")).status).toBe(401);
    const forged = await request(app).get("/api/v1/auth/me").set(bearer("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0."));
    expect(forged.status).toBe(401);
  });

  it("returns 403 for a citizen on admin/staff routes", async () => {
    const token = await login(app, "citizen@suraksha.demo");
    expect((await request(app).get("/api/v1/incidents").set(bearer(token))).status).toBe(403);
    expect((await request(app).get("/api/v1/dashboard/summary").set(bearer(token))).status).toBe(403);
    const patch = await request(app).patch("/api/v1/roads/49/status").set(bearer(token)).send({ status: "open", reason: "test" });
    expect(patch.status).toBe(403);
    expect(patch.body.error.code).toBe("FORBIDDEN");
  });
});
