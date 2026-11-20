// Builds deterministic seed SQL from the OpenStreetMap extract in simulation-data/.
//   010_road_network.sql  — road_nodes / road_edges (OSM topology, real geometry, ODbL)
//   020_demo_scenario.sql — SIMULATED shelters, teams, flood-risk zones, road closures, hazards
// Usage: node database/seeds/build-seed.mjs
import { readFileSync, writeFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const osm = JSON.parse(readFileSync(here("../../simulation-data/osm-darbhanga.json"), "utf8"));
const scenario = JSON.parse(readFileSync(here("../../simulation-data/demo-scenario.json"), "utf8"));

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
export function haversine([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---- 1. Topology: split ways into edges at intersections -------------------------------
const nodes = new Map();
for (const e of osm.elements) if (e.type === "node") nodes.set(e.id, [e.lon, e.lat]);
const ways = osm.elements.filter((e) => e.type === "way").sort((a, b) => a.id - b.id);
const uses = new Map();
for (const w of ways) w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));

const SPEED_KMH = { trunk: 50, trunk_link: 35, primary: 45, primary_link: 35, secondary: 40, secondary_link: 30, tertiary: 35, tertiary_link: 30, unclassified: 30, residential: 25, living_street: 15, service: 15 };
const ACCESS_BASE = { trunk: 5, trunk_link: 8, primary: 5, primary_link: 8, secondary: 8, secondary_link: 10, tertiary: 12, tertiary_link: 12, unclassified: 20, residential: 25, living_street: 30, service: 35 };
const FLOOD_BASE = { residential: 10, living_street: 15, service: 15, unclassified: 12 };
const UNPAVED = new Set(["unpaved", "ground", "dirt", "gravel", "mud", "sand", "earth", "grass", "compacted"]);

let edges = [];
for (const w of ways) {
  const hw = w.tags.highway;
  const ow = w.tags.oneway;
  const oneway = ow === "yes" || ow === "1" || ow === "-1" || w.tags.junction === "roundabout";
  const ids = ow === "-1" ? [...w.nodes].reverse() : w.nodes;
  const unpaved = UNPAVED.has(w.tags.surface);
  const modes = w.tags.foot === "no" ? ["driving"] : w.tags.motor_vehicle === "no" || w.tags.access === "no" ? ["walking"] : ["walking", "driving"];
  let start = 0;
  for (let i = 1; i < ids.length; i++) {
    if (i < ids.length - 1 && (uses.get(ids[i]) ?? 0) < 2) continue;
    const seg = ids.slice(start, i + 1).filter((n) => nodes.has(n));
    start = i;
    if (seg.length < 2 || seg[0] === seg[seg.length - 1]) continue;
    const coords = seg.map((n) => nodes.get(n));
    let len = 0;
    for (let k = 1; k < coords.length; k++) len += haversine(coords[k - 1], coords[k]);
    if (len < 0.5) continue;
    edges.push({
      source: seg[0], target: seg[seg.length - 1], coords, len, hw, oneway, modes, unpaved,
      name: w.tags.name ?? w.tags.ref ?? null, wayId: w.id,
      time: len / ((SPEED_KMH[hw] ?? 20) / 3.6),
    });
  }
}

// ---- 2. Keep the largest weakly connected component (no fictional connections) ---------
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
for (const e of edges) for (const n of [e.source, e.target]) if (!parent.has(n)) parent.set(n, n);
for (const e of edges) parent.set(find(e.source), find(e.target));
const size = new Map();
for (const n of parent.keys()) size.set(find(n), (size.get(find(n)) ?? 0) + 1);
const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
const before = edges.length;
edges = edges.filter((e) => find(e.source) === main);
edges.forEach((e, i) => (e.id = i + 1));

// ---- 3. SIMULATED modelled risk -------------------------------------------------------
const mid = (c) => c[Math.floor(c.length / 2)];
for (const e of edges) {
  const m = mid(e.coords);
  let zone = 0;
  for (const z of scenario.floodZones) {
    const d = haversine(m, z.center);
    if (d < z.radiusMeters) zone = Math.max(zone, z.peakRisk * (1 - d / z.radiusMeters));
  }
  e.flood = Math.min(100, Math.round((FLOOD_BASE[e.hw] ?? 5) + zone));
  e.access = Math.min(100, (ACCESS_BASE[e.hw] ?? 20) + (e.unpaved ? 25 : 0));
  e.wheelchair = !e.unpaved;
}

// ---- 4. SIMULATED road closures: edges under the scenario's closure polylines ---------
function pointSegDist(p, a, b) {
  // local equirectangular metres; fine for the few-metre tolerances used here
  const k = Math.cos(rad(p[1]));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy) * (R * Math.PI / 180);
}
const nearestEdge = (p, maxM) => {
  let best = null, bd = maxM;
  for (const e of edges) for (let k = 1; k < e.coords.length; k++) {
    const d = pointSegDist(p, e.coords[k - 1], e.coords[k]);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
const closures = scenario.roadClosures.map((c) => {
  const ids = new Set();
  for (const p of c.path) { const e = nearestEdge(p, 15); if (e) ids.add(e.id); }
  return { ...c, edgeIds: [...ids] };
});

// ---- 5. Emit SQL ------------------------------------------------------------------------
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const pt = ([x, y]) => `ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)`;
const line = (c) => `ST_GeomFromText('LINESTRING(${c.map(([x, y]) => `${x} ${y}`).join(",")})', 4326)`;
const usedNodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))].sort((a, b) => a - b);

let net = `-- GENERATED by build-seed.mjs from OpenStreetMap (© OpenStreetMap contributors, ODbL). Do not edit.\n-- Extract: ${osm.osm3s?.timestamp_osm_base ?? "unknown"}; bbox 26.115,85.86,26.18,85.945 (Darbhanga, Bihar)\n`;
net += `-- Flood/access risk values are SIMULATED (see simulation-data/demo-scenario.json), not observed data.\n`;
for (let i = 0; i < usedNodes.length; i += 1000) {
  net += `INSERT INTO road_nodes (id, location, external_id) VALUES\n${usedNodes.slice(i, i + 1000).map((n) => `(${n}, ${pt(nodes.get(n))}, 'osm:node/${n}')`).join(",\n")};\n`;
}
for (let i = 0; i < edges.length; i += 500) {
  net += `INSERT INTO road_edges (id, source_node_id, target_node_id, geom, length_meters, travel_time_seconds, road_type, name, oneway, flood_risk, access_risk, travel_modes, wheelchair_ok, source, external_id) VALUES\n${edges
    .slice(i, i + 500)
    .map((e) => `(${e.id}, ${e.source}, ${e.target}, ${line(e.coords)}, ${e.len.toFixed(2)}, ${e.time.toFixed(2)}, ${q(e.hw)}, ${q(e.name)}, ${e.oneway}, ${e.flood}, ${e.access}, '{${e.modes.join(",")}}', ${e.wheelchair}, 'osm', 'osm:way/${e.wayId}')`)
    .join(",\n")};\n`;
}
writeFileSync(here("./010_road_network.sql"), net);

let demo = `-- GENERATED by build-seed.mjs from simulation-data/demo-scenario.json. All facilities and conditions are SIMULATED.\n`;
for (const s of scenario.shelters) {
  demo += `INSERT INTO shelters (code, name, description, location, address, area, total_capacity, current_occupancy, operational_status, facilities, accessible, accessibility_notes, contact_phone, source) VALUES (${q(s.code)}, ${q(s.name)}, ${q(s.description)}, ${pt(s.location)}, ${q(s.address)}, ${q(s.area)}, ${s.capacity}, ${s.occupancy}, '${s.status}', '{${s.facilities.join(",")}}', ${s.accessible}, ${q(s.accessibilityNotes)}, ${q(s.contactPhone)}, 'simulated');\n`;
}
for (const t of scenario.teams) {
  demo += `INSERT INTO rescue_teams (code, name, kind, members, availability, capabilities, current_location, lead_name, lead_phone) VALUES (${q(t.code)}, ${q(t.name)}, ${q(t.kind)}, ${t.members}, '${t.availability}', '{${t.capabilities.join(",")}}', ${pt(t.location)}, ${q(t.leadName)}, ${q(t.leadPhone)});\n`;
}
for (const c of closures) {
  if (!c.edgeIds.length) throw new Error(`closure ${c.name} matched no edges`);
  demo += `UPDATE road_edges SET status = '${c.status}' WHERE id IN (${c.edgeIds.join(",")});\n`;
  const at = c.path[Math.floor(c.path.length / 2)];
  demo += `INSERT INTO hazard_reports (location, road_edge_id, hazard_type, severity, description, source, verification_status, applied_road_status, reported_at, verified_at) VALUES (${pt(at)}, ${c.edgeIds[0]}, '${c.hazardType}', '${c.severity}', ${q(`${c.name}: ${c.note}`)}, 'simulated', 'verified', '${c.status}', now() - interval '3 hours', now() - interval '2 hours');\n`;
}
for (const h of scenario.unverifiedHazards) {
  demo += `INSERT INTO hazard_reports (location, hazard_type, severity, description, source) VALUES (${pt(h.location)}, '${h.hazardType}', '${h.severity}', ${q(h.description)}, 'citizen');\n`;
}
demo += `UPDATE graph_state SET version = version + 1, updated_at = now(), reason = 'seed: demo scenario road conditions';\n`;
writeFileSync(here("./020_demo_scenario.sql"), demo);

const comp = [...size.values()].length;
console.log(`ways ${ways.length} → edges ${before} (${comp} components) → kept ${edges.length} edges / ${usedNodes.length} nodes in largest component`);
for (const c of closures) console.log(`closure ${c.name}: ${c.status} edges [${c.edgeIds.join(",")}]`);
