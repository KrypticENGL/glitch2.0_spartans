# Internal contract: Node API ⇄ Python routing engine

The routing engine is internal (Docker network only; never called by browsers). JSON is camelCase.
Coordinates in GeoJSON are `[longitude, latitude]`. Errors: `{ "error": { "code", "message", "details"? } }`.

## Data ownership
- PostgreSQL is authoritative. The engine **reads** `road_nodes`, `road_edges`, `graph_state` (never writes).
- The engine caches one graph snapshot per `graph_state.version`, loaded in a single REPEATABLE READ
  transaction (edges + version read together, so a snapshot is never a mix of two versions).
- Node bumps `graph_state.version` in the same DB transaction as any routing-relevant change
  (road status change, hazard verification that changes a road), then calls `POST /graph/reload`.
- Shelters are passed **in the request** by Node (Node owns capacity/status business data).

## Endpoints (engine, default port 8001)

### GET /health
`200 { "status": "ok", "graphVersion": 2, "nodes": 4564, "edges": 5763, "loadedAt": "ISO" }`
`503 { "status": "unavailable", "reason": "..." }` if no graph can be loaded.

### POST /graph/reload
Body `{ "expectedVersion"?: number }`. Reloads if DB version differs from cache.
`200 { "graphVersion": n, "reloaded": bool, "nodes", "edges", "excludedEdges": n }`.

### POST /routes/evaluate
Request:
```json
{
  "graphVersion": 2,
  "origin": { "latitude": 26.1542, "longitude": 85.896 },
  "peopleCount": 4,
  "travelMode": "walking",            // "walking" | "driving"
  "needsAccessibleRoute": false,
  "maxAlternatives": 3,               // 0..5 alternatives in addition to the recommended route
  "population": { "children": 1, "elderly": 1, "disabled": 0, "medicalNeeds": false },
  "weights": { "flood": 0.35, "access": 0.25, "distance": 0.15, "capacity": 0.15, "population": 0.10 },  // optional
  "shelters": [
    { "id": "uuid", "code": "shl-benta", "name": "Benta Stadium Camp", "longitude": 85.9, "latitude": 26.16,
      "totalCapacity": 1200, "availableCapacity": 660, "status": "open", "accessible": false }
  ]
}
```
- If `graphVersion` ≠ cached version, the engine reloads; if the DB version still differs → `409 GRAPH_VERSION_MISMATCH`
  with `details.currentVersion`. The engine never routes on a snapshot whose version ≠ request version.
- Invalid coordinates → `422 INVALID_COORDINATES`. Origin farther than `SNAP_MAX_METERS` from any eligible edge
  → `422 ORIGIN_NOT_ROUTABLE` (`details.nearestDistanceMeters`).

Response `200`:
```json
{
  "status": "ok",                     // "ok" | "no_route" | "insufficient_data"
  "graphVersion": 2,
  "calculatedAt": "ISO",
  "algorithm": "astar",               // or "dijkstra" when the heuristic is not admissible for the config
  "origin": { "input": [lon, lat], "snapped": [lon, lat], "edgeId": 123, "snapDistanceMeters": 14.2 },
  "candidates": [
    { "shelterId": "uuid", "code": "shl-benta", "eligible": true, "reachable": true, "excludedReason": null,
      "bestRiskScore": 31.4, "distanceMeters": 1820 }
  ],
  "recommended": Route | null,
  "alternatives": [Route],
  "excludedRoads": [ { "edgeId": 210, "name": "…", "status": "blocked", "roadType": "secondary" } ],
  "explanation": ["…derived from data…"],
  "weights": { … effective weights … },
  "policy": { "unknownRoad": "penalize", "restrictedRoad": "penalize", "blocked": "exclude" }
}
```
Route:
```json
{
  "id": "sha1 of edge ids+shelter",
  "rank": 1,
  "shelterId": "uuid", "shelterCode": "shl-benta", "shelterName": "…",
  "geometry": { "type": "LineString", "coordinates": [[lon, lat], …] },
  "edgeIds": [1, 2, 3],
  "distanceMeters": 1820.5, "durationSeconds": 1400.0,
  "riskScore": 31.4,                                   // R, 0..100, lower is better
  "riskBreakdown": { "flood": 22.0, "access": 18.0, "distance": 12.1, "capacity": 50.0, "population": 20.0 },
  "weightedContributions": { "flood": 7.7, … },
  "maxFloodRisk": 64, "roadStatusCounts": { "open": 30, "restricted": 0, "unknown": 2 },
  "sharedWithRecommended": 0.4,                        // fraction of length overlapping the recommended route
  "explanation": ["…"]
}
```

### Scoring model (implemented in the engine)
Stage A (path generation): per-edge nonnegative cost = travel time × (1 + αF·flood/100 + αA·access/100) × status
multiplier (restricted/unknown penalties per policy). Blocked edges are **not in the graph**. Accessible routes exclude
`wheelchair_ok = false` and restricted edges. Driving respects `oneway`; walking treats edges as bidirectional.
Stage B (route + shelter ranking): R = 0.35F + 0.25A + 0.15D + 0.15C + 0.10P on 0..100 factors:
F = length-weighted mean edge flood risk; A = length-weighted access risk (+ status penalty points);
D = min(100, distance / D_max × 100); C = projected occupancy after arrival (%); P = group vulnerability.
Weights are experimental and configurable; scores are not probabilities of safety.
