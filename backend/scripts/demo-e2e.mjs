// End-to-end demonstration against a running stack (API + routing engine + DB).
// Usage (from backend/api so dependencies resolve): node ../scripts/demo-e2e.mjs [http://localhost:4000]
// Requires seeded demo users (npm run seed:demo). Exits non-zero on any failed expectation.
import { io } from "socket.io-client";

const BASE = process.argv[2] ?? process.env.API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD || "suraksha-demo";
const ORIGIN = { latitude: 26.154152, longitude: 85.896217 }; // demo citizen location (Darbhanga Town)

let failures = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const login = async (email) => (await api("POST", "/auth/login", { body: { email, password: PASSWORD } })).json?.token;

function socket(token) {
  const s = io(BASE, { auth: token ? { token } : {}, transports: ["websocket"] });
  const events = [];
  s.onAny((type, payload) => events.push({ type, payload }));
  return { s, events, ready: new Promise((r) => s.on("connect", r)) };
}
const waitFor = async (events, type, pred = () => true, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = events.find((x) => x.type === type && pred(x.payload));
    if (e) return e.payload;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

const admin = await login("admin@suraksha.demo");
const citizen = await login("citizen@suraksha.demo");
ok(!!admin && !!citizen, "demo admin and citizen can log in");

const adminWs = socket(admin);
const citizenWs = socket(citizen);
await Promise.all([adminWs.ready, citizenWs.ready]);

// 1. Citizen requests evacuation routes
const t0 = performance.now();
const r1 = await api("POST", "/routes/evaluate", { token: citizen, body: { origin: ORIGIN, peopleCount: 4, travelMode: "walking", needsAccessibleRoute: false, maxAlternatives: 3 } });
const rec1 = r1.json?.recommended;
ok(r1.status === 200 && r1.json?.status === "ok" && rec1, "route evaluation returns a recommended route", `${Math.round(performance.now() - t0)} ms, graph v${r1.json?.graphVersion}`);
if (!rec1) process.exit(1);
console.log(`   → ${rec1.shelterName}: ${Math.round(rec1.distanceMeters)} m, R=${rec1.riskScore.toFixed(1)}, ${rec1.edgeIds.length} edges, ${r1.json.alternatives.length} alternatives`);
console.log(`   → why: ${rec1.explanation.join(" | ")}`);
ok(rec1.geometry?.type === "LineString" && rec1.geometry.coordinates[0].length === 2, "route geometry is GeoJSON LineString [lon, lat]");

// Citizen subscribes to their route record for invalidation updates
const ack = await new Promise((r) => citizenWs.s.emit("subscribe", { room: `route:${rec1.routeRecordId}` }, r));
ok(ack?.ok, "citizen subscribed to route room");
const deny = await new Promise((r) => citizenWs.s.emit("subscribe", { room: "admins" }, r));
ok(deny && !deny.ok, "citizen cannot join admins room");

// 2. Admin closes a road on the recommended route (middle edge)
const edgeId = rec1.edgeIds[Math.floor(rec1.edgeIds.length / 2)];
const close = await api("PATCH", `/roads/${edgeId}/status`, { token: admin, body: { status: "blocked", reason: "Demo: field team reports deep water" } });
ok(close.status === 200, `admin blocks road edge ${edgeId}`, `graph v${close.json?.graphVersion ?? close.json?.data?.graphVersion ?? "?"}`);
const inv = await waitFor(citizenWs.events, "route.invalidated", (p) => p.entityId === rec1.routeRecordId);
ok(!!inv, "citizen receives route.invalidated for the affected route");
const roadEvt = await waitFor(adminWs.events, "road.status.updated", (p) => String(p.entityId) === String(edgeId));
ok(!!roadEvt, "admin receives road.status.updated", roadEvt ? `graphVersion ${roadEvt.graphVersion}` : "");

// 3. Re-request: new route must avoid the blocked edge
const r2 = await api("POST", "/routes/evaluate", { token: citizen, body: { origin: ORIGIN, peopleCount: 4, travelMode: "walking", needsAccessibleRoute: false, maxAlternatives: 3 } });
const rec2 = r2.json?.recommended;
ok(r2.json?.graphVersion > r1.json.graphVersion, "graph version increased", `${r1.json.graphVersion} → ${r2.json?.graphVersion}`);
ok(rec2 && !rec2.edgeIds.includes(edgeId) && [rec2, ...r2.json.alternatives].every((r) => !r.edgeIds.includes(edgeId)), "no returned route uses the blocked edge");
if (rec2) console.log(`   → now ${rec2.shelterName}: ${Math.round(rec2.distanceMeters)} m, R=${rec2.riskScore.toFixed(1)}`);
const old = await api("GET", `/routes/${rec1.routeRecordId}`, { token: citizen });
ok(old.json?.status === "invalidated" || old.json?.data?.status === "invalidated", "old route record is marked invalidated");

// 4. SOS → priority → assignment → responder updates
const sos = await api("POST", "/sos", { token: citizen, headers: { "idempotency-key": `demo-${Date.now()}` }, body: { location: { latitude: 26.1405, longitude: 85.8865 }, emergencyType: "stranded", peopleCount: 6, childrenCount: 2, elderlyCount: 1, disabledCount: 0, medicalNeeded: true, trapped: true, lifeThreatening: false, notes: "Demo: family on roof", contactPhone: "+91 90000 00000" } });
const sosId = sos.json?.id ?? sos.json?.data?.id;
ok(sos.status === 201 || sos.status === 200, "citizen submits SOS", `priority ${sos.json?.priority ?? sos.json?.data?.priority}`);
const created = await waitFor(adminWs.events, "sos.created", (p) => p.entityId === sosId);
ok(!!created, "admin receives sos.created");
ok(!citizenWs.events.some((e) => e.type === "sos.created"), "citizen socket does not receive sos.created broadcast");

const teams = await api("GET", "/rescue-teams", { token: admin });
const list = teams.json?.data ?? teams.json?.items ?? teams.json;
const team = Array.isArray(list) ? list.find((t) => t.availability === "available") : null;
ok(!!team, "an available rescue team exists", team?.name);
const responderEmail = `${team.code.replace(/^team-/, "")}@suraksha.demo`;
const responder = await login(responderEmail);
ok(!!responder, `responder ${responderEmail} logs in`);
const respWs = socket(responder);
await respWs.ready;

const mission = await api("POST", "/missions", { token: admin, body: { sosRequestId: sosId, rescueTeamId: team.id, notes: "Demo assignment" } });
const missionId = mission.json?.id ?? mission.json?.data?.id;
ok(mission.status === 201 || mission.status === 200, "admin assigns rescue team");
ok(!!(await waitFor(respWs.events, "mission.assigned", (p) => p.entityId === missionId)), "responder receives mission.assigned");

for (const status of ["accepted", "en_route", "on_site", "completed"]) {
  const u = await api("PATCH", `/missions/${missionId}/status`, { token: responder, body: { status } });
  ok(u.status === 200, `responder sets mission ${status}`);
}
ok(!!(await waitFor(adminWs.events, "mission.status.updated", (p) => p.entityId === missionId && p.status === "completed")), "admin receives mission completion");
const bad = await api("PATCH", `/missions/${missionId}/status`, { token: responder, body: { status: "en_route" } });
ok(bad.status === 409 || bad.status === 400, "invalid transition after completion is rejected", String(bad.status));
const sosAfter = await api("GET", `/sos/${sosId}`, { token: admin });
ok((sosAfter.json?.status ?? sosAfter.json?.data?.status) === "resolved", "SOS is resolved after mission completion");

// 5. Restore the road so the demo can be re-run
await api("PATCH", `/roads/${edgeId}/status`, { token: admin, body: { status: "open", reason: "Demo reset" } });

for (const w of [adminWs, citizenWs, respWs]) w.s.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll demo checks passed");
process.exit(failures ? 1 : 0);
