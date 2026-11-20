import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import {
  HttpRoutingClient,
  RoutingEngineError,
  type EngineEvaluateRequest,
  type EngineEvaluateResponse,
  type EngineRoute,
  type RoutingClient,
} from "../src/services/routing-client.js";
import { bearer, login, makeTestApp } from "./helpers.js";

const calls: EngineEvaluateRequest[] = [];

function fakeRoute(req: EngineEvaluateRequest, rank: number, code: string, edgeIds: number[]): EngineRoute {
  const s = req.shelters.find((x) => x.code === code)!;
  return {
    id: `route-${rank}`,
    rank,
    shelterId: s.id,
    shelterCode: s.code,
    shelterName: s.name,
    geometry: { type: "LineString", coordinates: [[req.origin.longitude, req.origin.latitude], [s.longitude, s.latitude]] },
    edgeIds,
    distanceMeters: 1500 + rank,
    durationSeconds: 1200,
    riskScore: 20 + rank,
    riskBreakdown: { flood: 10, access: 5, distance: 12, capacity: 45, population: 0 },
    weightedContributions: { flood: 3.5 },
    explanation: ["test"],
  };
}

const stub: RoutingClient = {
  async evaluate(req) {
    calls.push(req);
    const res: EngineEvaluateResponse = {
      status: "ok",
      graphVersion: req.graphVersion,
      calculatedAt: new Date().toISOString(),
      algorithm: "astar",
      recommended: fakeRoute(req, 1, "shl-benta", [101, 102]),
      alternatives: [fakeRoute(req, 2, "shl-kadirabad", [101, 205])],
      explanation: ["stub"],
    };
    return res;
  },
  reload: () => Promise.resolve({}),
  health: () => Promise.resolve({ status: "ok", graphVersion: 1 }),
};

const ctx = makeTestApp({ routing: stub });
const down = makeTestApp({ routing: new HttpRoutingClient("http://127.0.0.1:9", 1000, createLogger("silent")) });
afterAll(async () => {
  await ctx.pool.end();
  await down.pool.end();
});

const body = { origin: { latitude: 26.1542, longitude: 85.896 }, peopleCount: 3, travelMode: "walking", population: { children: 1, elderly: 1, disabled: 0, medicalNeeds: false } };

describe("POST /routes/evaluate", () => {
  it("maps the request, persists route records and enriches the response", async () => {
    const token = await login(ctx.app, "citizen@suraksha.demo");
    const res = await request(ctx.app).post("/api/v1/routes/evaluate").set(bearer(token)).send(body);
    expect(res.status).toBe(200);

    const sent = calls.at(-1)!;
    const { rows: g } = await ctx.pool.query(`SELECT version FROM graph_state`);
    expect(sent).toMatchObject({
      graphVersion: g[0].version,
      origin: { latitude: 26.1542, longitude: 85.896 },
      peopleCount: 3,
      travelMode: "walking",
      needsAccessibleRoute: false,
      maxAlternatives: 2,
      population: { children: 1, elderly: 1, disabled: 0, medicalNeeds: false },
    });
    const benta = sent.shelters.find((s) => s.code === "shl-benta")!;
    const { rows: sh } = await ctx.pool.query(`SELECT total_capacity - current_occupancy - reserved_count AS a FROM shelters WHERE code = 'shl-benta'`);
    expect(benta.availableCapacity).toBe(sh[0].a);
    expect(sent.shelters.length).toBeGreaterThanOrEqual(8);

    expect(res.body.status).toBe("ok");
    expect(res.body.recommended.routeRecordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.alternatives).toHaveLength(1);
    expect(res.body.sourceClassification).toBe("OSM road network; simulated hazards/shelters");
    expect(res.body.disclaimer).toBeTypeOf("string");
    expect(res.body.routeRecordExpiresAt).toBeTypeOf("string");

    const { rows } = await ctx.pool.query(
      `SELECT r.edge_ids, r.status, r.people_count, r.travel_mode, r.requested_by IS NOT NULL AS has_user, s.code,
         round(extract(epoch FROM r.expires_at - r.calculated_at) / 60) AS ttl
       FROM route_records r JOIN shelters s ON s.id = r.destination_shelter_id WHERE r.id = ANY($1::uuid[]) ORDER BY r.risk_score`,
      [[res.body.recommended.routeRecordId, res.body.alternatives[0].routeRecordId]],
    );
    expect(rows).toEqual([
      { edge_ids: [101, 102], status: "valid", people_count: 3, travel_mode: "walking", has_user: true, code: "shl-benta", ttl: "30" },
      { edge_ids: [101, 205], status: "valid", people_count: 3, travel_mode: "walking", has_user: true, code: "shl-kadirabad", ttl: "30" },
    ]);

    const record = await request(ctx.app).get(`/api/v1/routes/${res.body.recommended.routeRecordId}`);
    expect(record.status).toBe(200);
    expect(record.body).toMatchObject({ status: "valid", edgeIds: [101, 102], peopleCount: 3 });
  });

  it("returns 503 ROUTING_UNAVAILABLE when the engine is unreachable", async () => {
    const res = await request(down.app).post("/api/v1/routes/evaluate").send(body);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTING_UNAVAILABLE");
  });

  it("validates bounds and enums", async () => {
    const res = await request(ctx.app).post("/api/v1/routes/evaluate").send({ ...body, origin: { latitude: 30, longitude: 85 }, travelMode: "flying" });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["origin.latitude", "travelMode"]));
  });
});

describe("HttpRoutingClient", () => {
  async function engine(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
    const server = createServer(handler);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }

  it("on GRAPH_VERSION_MISMATCH reloads and retries once with the fresh version", async () => {
    const seen: { path: string; body: { graphVersion?: number; expectedVersion?: number } }[] = [];
    let evaluations = 0;
    const { server, url } = await engine((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : {} });
        res.setHeader("content-type", "application/json");
        if (req.url === "/graph/reload") return res.end(JSON.stringify({ graphVersion: 7, reloaded: true }));
        if (evaluations++ === 0) {
          res.statusCode = 409;
          return res.end(JSON.stringify({ error: { code: "GRAPH_VERSION_MISMATCH", message: "stale", details: { currentVersion: 7 } } }));
        }
        res.end(JSON.stringify({ status: "no_route", graphVersion: 7, calculatedAt: new Date().toISOString(), recommended: null, alternatives: [] }));
      });
    });
    try {
      const client = new HttpRoutingClient(url, 2000, createLogger("silent"));
      const out = await client.evaluate(
        { graphVersion: 6, origin: { latitude: 26.15, longitude: 85.9 }, peopleCount: 1, travelMode: "walking", needsAccessibleRoute: false, maxAlternatives: 0, shelters: [] },
        async () => 7,
      );
      expect(out.status).toBe("no_route");
      expect(seen.map((s) => s.path)).toEqual(["/routes/evaluate", "/graph/reload", "/routes/evaluate"]);
      expect(seen[1]!.body.expectedVersion).toBe(7);
      expect(seen[2]!.body.graphVersion).toBe(7);
    } finally {
      server.close();
    }
  });

  it("times out with ENGINE_UNREACHABLE", async () => {
    const { server, url } = await engine(() => undefined); // never responds
    try {
      const client = new HttpRoutingClient(url, 500, createLogger("silent"));
      await expect(client.health(300)).rejects.toBeInstanceOf(RoutingEngineError);
      await expect(client.health(300)).rejects.toMatchObject({ code: "ENGINE_UNREACHABLE" });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
