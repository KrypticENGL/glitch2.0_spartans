// One-off generator for illustrative demo route geometry.
// Fetches road-following polylines from the public OSRM demo server (OpenStreetMap data)
// and writes them to src/data/mock/routes.generated.json. The app never calls OSRM at runtime.
// Usage: node scripts/generate-routes.mjs   (be gentle: the demo server is rate limited)
import { writeFile } from "node:fs/promises";

const OSRM = "https://router.project-osrm.org";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [lng, lat] — approximate locality positions in and around Darbhanga, Bihar.
const ORIGIN = [85.896, 26.1542];
const SHELTERS = {
  "shl-laheriasarai": [85.904, 26.129],
  "shl-donar": [85.884, 26.14],
  "shl-kadirabad": [85.913, 26.162],
  "shl-allalpatti": [85.878, 26.158],
  "shl-benta": [85.899, 26.165],
  "shl-shubhankarpur": [85.865, 26.15],
  "shl-mabbi": [85.93, 26.115],
  "shl-bahadurpur": [85.92, 26.145],
};
const TEAM_BASES = {
  "team-ndrf-1": [85.9045, 26.1405],
  "team-sdrf-2": [85.889, 26.1515],
  "team-boat-3": [85.9175, 26.1335],
  "team-med-4": [85.9005, 26.1435],
  "team-civ-5": [85.8805, 26.1655],
};
const INCIDENTS = {
  "INC-1041": [85.891, 26.1325],
  "INC-1042": [85.9105, 26.1205],
  "INC-1043": [85.873, 26.1415],
  "INC-1044": [85.925, 26.1385],
  "INC-1045": [85.8865, 26.1605],
  "INC-1046": [85.9085, 26.1525],
  "INC-1047": [85.8695, 26.1575],
  "INC-1048": [85.935, 26.1245],
  "INC-1049": [85.8975, 26.1365],
  "INC-1050": [85.915, 26.1695],
};
// Responder demo routes: base -> incident
const MISSION_LEGS = [
  ["team-ndrf-1", "INC-1041"],
  ["team-boat-3", "INC-1042"],
  ["team-sdrf-2", "INC-1045"],
  ["team-med-4", "INC-1049"],
  ["team-boat-3", "INC-1048"],
];

const round = (c) => [Number(c[0].toFixed(6)), Number(c[1].toFixed(6))];

async function osrm(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${OSRM}${path}`);
    if (res.ok) {
      const json = await res.json();
      if (json.code === "Ok") return json;
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`OSRM failed: ${path}`);
}

async function snap(c) {
  const j = await osrm(`/nearest/v1/driving/${c[0]},${c[1]}?number=1`);
  await sleep(400);
  return round(j.waypoints[0].location);
}

const toRoute = (r) => ({
  distanceM: Math.round(r.distance),
  durationS: Math.round(r.duration),
  coordinates: r.geometry.coordinates.map(round),
});

async function routes(a, b) {
  const q = "overview=full&geometries=geojson";
  const j = await osrm(`/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?${q}&alternatives=3`);
  await sleep(500);
  const out = j.routes.map(toRoute);
  if (out.length < 3) {
    // Force a detour through a point offset perpendicular to the straight line.
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    for (const sign of [1, -1]) {
      if (out.length >= 3) break;
      const via = [mid[0] - (dy / len) * 0.008 * sign, mid[1] + (dx / len) * 0.008 * sign];
      const v = await osrm(`/route/v1/driving/${a[0]},${a[1]};${via[0]},${via[1]};${b[0]},${b[1]}?${q}`);
      await sleep(500);
      const r = toRoute(v.routes[0]);
      const dup = out.some((o) => Math.abs(o.distanceM - r.distanceM) < 60);
      if (!dup && r.distanceM < out[0].distanceM * 2.2) out.push(r);
    }
  }
  return out;
}

const result = { source: "OSRM demo server / OpenStreetMap contributors", generatedAt: new Date().toISOString().slice(0, 10), origin: await snap(ORIGIN), shelters: {}, teamBases: {}, incidents: {}, shelterRoutes: {}, missionRoutes: {} };

for (const [id, c] of Object.entries(SHELTERS)) result.shelters[id] = await snap(c);
for (const [id, c] of Object.entries(TEAM_BASES)) result.teamBases[id] = await snap(c);
for (const [id, c] of Object.entries(INCIDENTS)) result.incidents[id] = await snap(c);

for (const id of Object.keys(SHELTERS)) {
  result.shelterRoutes[id] = await routes(result.origin, result.shelters[id]);
  console.log(id, result.shelterRoutes[id].map((r) => r.distanceM));
}
for (const [team, inc] of MISSION_LEGS) {
  result.missionRoutes[`${team}:${inc}`] = (await routes(result.teamBases[team], result.incidents[inc]))[0];
}

await writeFile(new URL("../src/data/mock/routes.generated.json", import.meta.url), JSON.stringify(result));
console.log("written");
