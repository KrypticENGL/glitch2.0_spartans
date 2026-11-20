import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { createPool } from "../src/db/pool.js";
import { createLogger } from "../src/lib/logger.js";
import type { RealtimeEvent, SubscribeAck } from "../src/realtime/events.js";
import { RealtimeHub } from "../src/realtime/hub.js";
import { SOS_BODY, bearer, login, teamId, testEnv, unavailableRouting } from "./helpers.js";

const config = loadConfig(testEnv());
const logger = createLogger("silent");
const pool = createPool(config.DATABASE_URL, 1);
const hub = new RealtimeHub(config.JWT_SECRET, config.CORS_ORIGINS, logger);
const app = createApp({ config, pool, logger, routing: unavailableRouting, realtime: hub });
const server = createServer(app);
hub.attach(server);
let url = "";
const sockets: Socket[] = [];

function connect(token?: string): Promise<Socket> {
  const s = ioClient(url, { path: "/socket.io", transports: ["websocket"], auth: token ? { token } : {}, forceNew: true, reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

const subscribe = (s: Socket, room: string) => s.timeout(2000).emitWithAck("subscribe", { room }) as Promise<SubscribeAck>;

function next(s: Socket, event: string, predicate: (e: RealtimeEvent) => boolean = () => true): Promise<RealtimeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
    const handler = (e: RealtimeEvent) => {
      if (!predicate(e)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(e);
    };
    s.on(event, handler);
  });
}

/** Resolves false if the event does NOT arrive within `ms`. */
function never(s: Socket, event: string, ms = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => resolve(true);
    s.once(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve(false);
    }, ms);
  });
}

let admin: string;
let citizen: string;
let civResponder: string;

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await login(app, "admin@suraksha.demo");
  citizen = await login(app, "citizen@suraksha.demo");
  civResponder = await login(app, "civ-5@suraksha.demo");
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await hub.close();
  await pool.end();
});

describe("realtime", () => {
  it("rejects an invalid token at handshake", async () => {
    await expect(connect("not-a-jwt")).rejects.toThrow("UNAUTHORIZED");
  });

  it("admins receive sos.created; anonymous public sockets do not", async () => {
    const adminSocket = await connect(admin);
    const anon = await connect();
    const anonGot = never(anon, "sos.created");
    const received = next(adminSocket, "sos.created");
    const res = await request(app).post("/api/v1/sos").send(SOS_BODY);
    const evt = await received;
    expect(evt).toMatchObject({ type: "sos.created", entityId: res.body.id, status: "new" });
    expect(evt.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(evt.data).toMatchObject({ code: res.body.code });
    expect(await anonGot).toBe(false);
  });

  it("enforces room authorization on subscribe", async () => {
    const civTeam = await teamId(pool, "team-civ-5");
    const ndrfTeam = await teamId(pool, "team-ndrf-1");
    const c = await connect(citizen);
    expect(await subscribe(c, "admins")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await subscribe(c, `team:${civTeam}`)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await subscribe(c, "user:00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await subscribe(c, "whatever")).toEqual({ ok: false, error: "INVALID_ROOM" });
    expect(await subscribe(c, "public")).toEqual({ ok: true });

    const r = await connect(civResponder);
    expect(await subscribe(r, `team:${ndrfTeam}`)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await subscribe(r, `team:${civTeam}`)).toEqual({ ok: true });

    const a = await connect(admin);
    expect(await subscribe(a, `team:${ndrfTeam}`)).toEqual({ ok: true });
  });

  it("responder receives mission.assigned in their team room (auto-joined)", async () => {
    const civTeam = await teamId(pool, "team-civ-5");
    const responder = await connect(civResponder);
    const citizenSocket = await connect(citizen);
    const citizenGot = never(citizenSocket, "mission.assigned");
    const sos = await request(app).post("/api/v1/sos").send(SOS_BODY);
    const got = next(responder, "mission.assigned", (e) => (e.data as { sosRequestId?: string }).sosRequestId === sos.body.id);
    const res = await request(app).post("/api/v1/missions").set(bearer(admin)).send({ sosRequestId: sos.body.id, rescueTeamId: civTeam });
    expect(res.status).toBe(201);
    const evt = await got;
    expect(evt).toMatchObject({ type: "mission.assigned", entityId: res.body.id, status: "assigned" });
    expect(await citizenGot).toBe(false);
    // tidy: free the team for other tests
    await request(app).patch(`/api/v1/missions/${res.body.id}/status`).set(bearer(admin)).send({ status: "cancelled" });
  });

  it("route.invalidated reaches route room subscribers; after reconnect REST shows current state", async () => {
    const { rows: e } = await pool.query<{ id: number }>(`SELECT id FROM road_edges WHERE status = 'open' ORDER BY id DESC LIMIT 1`);
    const edgeId = e[0]!.id;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO route_records (origin, destination_shelter_id, geometry, edge_ids, risk_score, risk_breakdown, people_count, travel_mode, graph_version, expires_at)
       SELECT ST_SetSRID(ST_MakePoint(85.896, 26.154), 4326), (SELECT id FROM shelters WHERE code = 'shl-benta'),
         ST_GeomFromText('LINESTRING(85.896 26.154, 85.9 26.16)', 4326), ARRAY[$1]::bigint[], 5, '{}', 1, 'walking', (SELECT version FROM graph_state), now() + interval '30 minutes'
       RETURNING id`,
      [edgeId],
    );
    const routeId = rows[0]!.id;

    const anon = await connect();
    expect(await subscribe(anon, `route:${routeId}`)).toEqual({ ok: true });
    const got = next(anon, "route.invalidated");
    const patch = await request(app).patch(`/api/v1/roads/${edgeId}/status`).set(bearer(admin)).send({ status: "blocked", reason: "realtime test" });
    expect(patch.status).toBe(200);
    const evt = await got;
    expect(evt).toMatchObject({ type: "route.invalidated", entityId: routeId, status: "invalidated", graphVersion: patch.body.graphVersion });

    // Simulate a dropped connection: the client misses events while offline, then refetches REST state.
    anon.disconnect();
    await request(app).patch(`/api/v1/roads/${edgeId}/status`).set(bearer(admin)).send({ status: "restricted", reason: "partially reopened" });
    const again = await connect();
    expect(await subscribe(again, `route:${routeId}`)).toEqual({ ok: true });
    const route = await request(app).get(`/api/v1/routes/${routeId}`);
    expect(route.body).toMatchObject({ status: "invalidated", invalidationReason: expect.stringContaining("realtime test") });
    expect(route.body.currentGraphVersion).toBe(patch.body.graphVersion + 1);
    const road = await request(app).get(`/api/v1/roads/${edgeId}`);
    expect(road.body.status).toBe("restricted");
  });
});
