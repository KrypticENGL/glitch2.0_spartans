# SURAKSHA backend

Risk-aware evacuation routing and rescue coordination for flood-prone Darbhanga, Bihar.

```text
Next.js frontend ──REST + Socket.IO──▶ Express API (api/, :4000) ──HTTP (internal)──▶ Routing engine (routing-engine/, :8001)
                                            │                                              │ reads graph snapshot
                                            └──────────────── PostgreSQL + PostGIS ◀───────┘
```

- **API** (Node.js, TypeScript, Express 5, Zod, Socket.IO): the only public entry point. Owns auth, business rules, transactions, audit logs and real-time events.
- **Routing engine** (Python, FastAPI, NetworkX): internal only (no published port in Compose). Reads the road graph from PostGIS, caches one snapshot per graph version, and runs custom Dijkstra / A* / Yen searches plus the multi-factor scoring.
- **PostgreSQL + PostGIS**: authoritative store. `graph_state.version` is bumped in the same transaction as any routing-relevant change.

> **Demonstration data.** The road network is real OpenStreetMap topology and geometry. Shelters, teams, incidents, flood-risk zones and road closures are **simulated**. Risk scores are experimental ranking aids, not probabilities of safety, and no route is guaranteed safe. The priority model is decision support, not a validated dispatch protocol.

## Quick start (Docker)

```bash
cd backend
cp .env.example .env                 # set POSTGRES_PASSWORD and JWT_SECRET (>= 32 chars)
docker compose up --build -d
docker compose run --rm api npm run db:setup   # migrations + OSM road network + demo scenario + demo users
open http://localhost:4000/api/docs            # OpenAPI / Swagger UI
```

## Without Docker (how this repo was verified)

`devdb/` runs real PostgreSQL 17 + PostGIS 3.6 in-process (PGlite) behind the Postgres wire protocol. It serialises all connections through one session, so it is for development and tests only.

```bash
cd backend/devdb && npm install && node server.mjs --port 54329          # terminal 1
cd backend/api && npm install
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres DB_POOL_MAX=1
npm run db:reset && npm run seed:demo
cd ../routing-engine && uv sync && uv run uvicorn app.main:app --port 8001   # terminal 2
cd ../api && JWT_SECRET=$(openssl rand -hex 32) npm run dev                 # terminal 3
node ../scripts/demo-e2e.mjs http://localhost:4000                          # live demo walkthrough
```

## Data and provenance

| Data | Source | Notes |
|---|---|---|
| Road network | OpenStreetMap via Overpass (`simulation-data/osm-darbhanga.json`, ODbL) | Ways split at shared nodes into edges; largest connected component kept (no invented connections). 5,763 edges / 4,564 nodes. |
| Edge lengths | Haversine over OSM geometry | Metres, not degree differences. |
| Travel time | Length / nominal speed per `highway` class | Driving baseline. Walking uses 1.3 m/s (1.0 m/s for accessible routes). |
| Flood / access risk | **Simulated**: synthetic flood zones + road class + surface | `simulation-data/demo-scenario.json`. |
| Closures, shelters, teams, incidents | **Simulated** | Mirror the frontend demo scenario. |

Regenerate: `node simulation-data/build-scenario.mjs && node database/seeds/build-seed.mjs`.

## Routing model

**Hard constraints (Stage A filter).** Blocked edges are removed from the graph, never just penalised. Driving respects `oneway`; walking treats edges as bidirectional. Accessible routes exclude non-wheelchair edges, restricted edges, and shelters without accessible facilities. Closed, full, or too-small shelters (available capacity < group size) are ineligible and reported with a reason. `unknown` road status is **not** treated as safe; it is penalised (or excluded with `UNKNOWN_ROAD_POLICY=exclude`).

**Path generation (Stage A cost).** Per-edge, nonnegative cost = travel time × (1 + flood and access terms) × status multiplier. A* uses the heuristic `haversine_remaining / max_speed`, which is admissible because every multiplier is ≥ 1; if a configuration breaks that, the engine falls back to Dijkstra and says so. Alternatives come from Yen's k-shortest loopless paths with a length-overlap diversity filter.

**Route and shelter ranking (Stage B).** `R = 0.35F + 0.25A + 0.15D + 0.15C + 0.10P`, each factor 0–100:
- F: length-weighted flood risk
- A: length-weighted access risk plus status penalty
- D: distance relative to a per-mode maximum
- C: projected shelter occupancy after the group arrives
- P: group vulnerability

Weights are configurable per request. Shelter factors are applied once per route, not per edge. Each route returns its breakdown and explanation sentences computed from these numbers.

**Dynamic updates.** Changing road status or verifying a hazard with a road effect runs one transaction: update the edge, bump `graph_state.version`, invalidate overlapping `route_records`, and write the audit log. After commit, the API asks the engine to reload and emits `road.status.updated` and `route.invalidated`. The engine refuses to route on a snapshot whose version differs from the version the API read (`409 GRAPH_VERSION_MISMATCH`, retried once after reload). Unverified citizen reports never change road status.

## Repository layout

```
backend/
├── api/                 Express API (src/modules/*, realtime, tests), scripts/db.mjs migration runner
├── routing-engine/      FastAPI engine (app/graph, app/algorithms, app/scoring, app/services, tests)
├── database/migrations  SQL migrations (PostGIS, constraints, GiST indexes)
├── database/seeds       generated OSM network + demo scenario SQL, build-seed.mjs
├── simulation-data/     OSM extract, demo scenario, scenario builder
├── shared/              routing contract, OpenAPI spec + generated TS types
├── devdb/               PGlite PostGIS dev/test database server
├── scripts/demo-e2e.mjs end-to-end demonstration
└── docker-compose.yml
```
