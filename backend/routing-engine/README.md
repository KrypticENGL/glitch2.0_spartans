# SURAKSHA routing engine

Internal FastAPI service that ranks flood-evacuation routes to shelters (Darbhanga, Bihar). API contract:
`../shared/routing-contract.md`. It reads `road_nodes`, `road_edges` and `graph_state` from PostGIS and never writes.

## Run

```bash
uv sync
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54399/postgres uv run uvicorn app.main:app --port 8001
uv run pytest -q                                   # unit + API tests; DB integration tests skip if DB is unreachable
DATABASE_URL=... uv run python scripts/benchmark.py 30
docker build -t suraksha-routing . && docker run -p 8001:8001 -e DATABASE_URL=... suraksha-routing
```

Endpoints: `GET /health`, `POST /graph/reload`, `POST /routes/evaluate`.

## Graph

- One `Snapshot` per `graph_state.version`, loaded in a single REPEATABLE READ transaction (version, nodes, edges).
  It's loaded at startup and again lazily when a request needs it. If the DB is unreachable, the endpoints return 503.
- Topology validation drops edges with missing nodes, self loops, broken geometry, zero length or a travel time that is not positive.
  It also re-orients geometry that is stored target to source. Lengths are recomputed with haversine.
- Per travel profile (mode × accessible), the engine builds an adjacency of arcs `(v, cost, edgeId, fracFrom, fracTo)`.
  Walking adds both directions, while driving respects `oneway`. **Blocked edges are removed, never penalised.**
  `Profile.to_networkx()` exports a `MultiDiGraph`, which is used as the reference in tests.
- A grid spatial index over edge segments (~440 m cells) is built at load time.

## Algorithm (`POST /routes/evaluate`)

1. Check the version. If the request's `graphVersion` differs from the cache, the engine reloads. If it still differs, it returns `409 GRAPH_VERSION_MISMATCH`.
2. **Snap** the origin to the nearest *eligible edge* (not node). The distance is measured point-to-segment in a local
   tangent plane. If that is beyond `SNAP_MAX_METERS`, the engine returns `422 ORIGIN_NOT_ROUTABLE`. The edge is split into a virtual origin
   node with partial-cost arcs to its endpoints, and driving respects `oneway`. Shelters snap the same way into incoming-only
   virtual nodes. A shelter that doesn't snap is marked `not_connected_to_network`.
3. One **multi-target Dijkstra** (custom, heapq) runs from the origin to all eligible shelters on Stage-A cost.
4. For the top `CANDIDATE_SHELTERS` (4) reachable shelters:
   - **A\*** finds the best path. Its heuristic is `haversine(remaining) / max_speed(mode)`, which is admissible because every
     arc costs at least `length / max_speed` when all multipliers are ≥ 1. If the config makes a multiplier < 1, the heuristic is
     turned off and the response reports `algorithm: "dijkstra"`. A* cost is asserted equal to Dijkstra's.
   - **Yen's k-shortest loopless paths** generate up to `YEN_PATHS_PER_SHELTER`. Each spur search is an A* that uses the
     exact reverse-Dijkstra cost-to-go as a consistent heuristic. Generation stops at `ROUTING_TIME_BUDGET_SECONDS`.
5. **Stage B** scores every (shelter, path). The recommended route has the lowest R. The alternatives are the next-best routes, which can go to
   other shelters, and each must share ≤ `OVERLAP_THRESHOLD` (0.7) of its length with every route already chosen.

Route geometry joins the actual edge geometries, each oriented in the direction travelled, plus the partial
snapped pieces at both ends.

## Cost model

Stage A (path generation), per edge:
`cost = travel_time × (1 + ALPHA_FLOOD·flood/100 + ALPHA_ACCESS·access/100) × status_multiplier`
- travel_time: walking uses `length / 1.3 m/s` (1.0 m/s for accessible routes). Driving uses `travel_time_seconds` from the DB.
- The status multiplier is `RESTRICTED_MULTIPLIER` (3.0) for restricted roads, `UNKNOWN_MULTIPLIER` (1.5) for unknown roads and 1 for open roads.

Stage B (route + shelter), `R = 0.35F + 0.25A + 0.15D + 0.15C + 0.10P`. Each factor runs 0..100, lower is better, and
request weights are normalised to sum 1:
- F: length-weighted mean flood_risk.
- A: length-weighted mean of `access_risk + status points` (restricted +30, unknown +15), capped at 100.
- D: `min(100, distance / D_max × 100)`, with D_max 6000 m walking and 15000 m driving.
- C: projected occupancy after arrival, `100 × (total − available + people) / total`.
- P: `min(100, 50 × (children + elderly + 2·disabled) / peopleCount + (30 if medicalNeeds))`. P is the same for every route in a request.

Scores are experimental rankings, not probabilities of safety.

Shelter eligibility (`excludedReason`):
- `closed` / `full`: the shelter's status.
- `insufficient_capacity`: `availableCapacity < peopleCount`.
- `not_accessible`: an accessible route was requested and the shelter isn't accessible.
- `invalid_coordinates`: the shelter's coordinates are invalid.
- `not_connected_to_network`: the shelter didn't snap to the network.
- `no_path_in_graph`: the shelter is eligible but unreachable.

## Policies and env vars

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | – | PostGIS connection string |
| `SNAP_MAX_METERS` | 400 | max origin/shelter snap distance |
| `UNKNOWN_ROAD_POLICY` | penalize | `penalize` (×UNKNOWN_MULTIPLIER) or `exclude` |
| `RESTRICTED_POLICY` | penalize | `penalize` (×RESTRICTED_MULTIPLIER) or `exclude`; accessible routes always exclude |
| `ALPHA_FLOOD`, `ALPHA_ACCESS` | 2.0, 1.0 | Stage-A hazard multipliers |
| `RESTRICTED_MULTIPLIER`, `UNKNOWN_MULTIPLIER` | 3.0, 1.5 | Stage-A status multipliers |
| `RESTRICTED_ACCESS_POINTS`, `UNKNOWN_ACCESS_POINTS` | 30, 15 | Stage-B access penalty points |
| `WEIGHT_FLOOD` … `WEIGHT_POPULATION` | 0.35/0.25/0.15/0.15/0.10 | default Stage-B weights |
| `WALKING_SPEED_MPS`, `ACCESSIBLE_WALKING_SPEED_MPS` | 1.3, 1.0 | walking speeds |
| `D_MAX_WALKING_METERS`, `D_MAX_DRIVING_METERS` | 6000, 15000 | distance normaliser |
| `MAX_ALTERNATIVES` | 5 | cap on alternatives |
| `CANDIDATE_SHELTERS`, `YEN_PATHS_PER_SHELTER` | 4, 6 | search breadth |
| `OVERLAP_THRESHOLD` | 0.7 | diversity filter |
| `EXCLUDED_ROADS_BUFFER_METERS`, `EXCLUDED_ROADS_CAP` | 300, 50 | `excludedRoads` area / size |
| `ROUTING_TIME_BUDGET_SECONDS` | 5 | Yen generation stops after this |

Additive response fields beyond the contract: `computeMs` (top level) and `excludedRoads[].reason`.
