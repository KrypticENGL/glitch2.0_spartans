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
npm run demo -- http://localhost:4000                                       # live demo walkthrough (26 checks)
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

## API reference (`api/`)

Node.js 22+ · TypeScript · Express 5 · Socket.IO · PostgreSQL/PostGIS. Interactive docs: `GET /api/docs` (OpenAPI 3.1 JSON at `/api/docs/openapi.json`; checked-in copy and TS types in `backend/shared/openapi/`).

**Run locally (no Docker)**
```bash
node backend/devdb/server.mjs --memory --port 54397          # Postgres 17 + PostGIS (dev only)
cd backend/api && cp .env.example .env                        # set JWT_SECRET; DB_POOL_MAX=1 with devdb
npm install && npm run db:reset && npm run seed:demo && npm run dev   # http://localhost:4000
npm test                                                      # starts its own in-process DB
```
Scripts: `dev`, `build`, `start`, `test`, `typecheck`, `migrate`, `seed`, `db:reset`, `seed:demo` (`seed:demo:prod` from dist), `openapi:generate`.

**Conventions.** All JSON is camelCase; geometry is GeoJSON `[longitude, latitude]`; inputs use `{latitude, longitude}` and must fall inside Bihar (lat 24–27.6, lon 83–88.3). Errors: `{ "error": { "code", "message", "details?", "requestId" } }` (`X-Request-Id` echoed). Lists: `?page=&pageSize=` → `{ data, page, pageSize, total }`.

**Auth.** `Authorization: Bearer <JWT>` (HS256, 1 h). Roles: `citizen`, `responder` (linked to a rescue team), `admin`. Registration creates citizens only.

| Area | Endpoints (prefix `/api/v1`) | Access |
|---|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | public / user |
| Shelters | `GET /shelters?lat&lng&radiusMeters&status&available&facility&accessible`, `GET /shelters/:id`, `GET /shelters/:id/occupancy` | public |
| | `POST /shelters/:id/reservations` (2 h hold) | user |
| | `PATCH /shelters/:id` (capacity, occupancy, open/closed; status derived ≥90 % near_capacity, 100 % full) | admin |
| Routes | `POST /routes/evaluate` (`no_route` is HTTP 200 with `status:"no_route"`; engine down → 503 `ROUTING_UNAVAILABLE`), `GET /routes/:id` (valid / invalidated / expired) | public (user optional) |
| Roads | `GET /roads?bbox=&status=&format=geojson`, `GET /roads/:id` | public |
| | `PATCH /roads/:id/status` → bumps graph version, invalidates crossing routes | admin |
| Hazards | `POST /hazards` (citizen reports are unverified and never change roads), `GET /hazards` (public: verified only), `GET /hazards/:id` | public |
| | `PATCH /hazards/:id/verify` (`verified`/`rejected`, optional `appliedRoadStatus`), `PATCH /hazards/:id/status` (resolve, optional road re-open) | admin |
| SOS | `POST /sos` (`Idempotency-Key` header; repeat → 200 with original), `GET /sos/:id` | public / requester+staff |
| Incidents | `GET /incidents?status&priority` (priority, then oldest first) | admin, responder |
| | `PATCH /incidents/:id/status`, `PATCH /incidents/:id/priority` (override + reason), `POST /incidents/:id/reevaluate` | admin |
| Rescue | `GET /rescue-teams`, `GET /rescue-teams/:id`, `GET /missions`, `GET /missions/:id` (responders: own team) | admin, responder |
| | `POST /missions` (reassigning cancels the previous active mission) | admin |
| | `PATCH /missions/:id/status` (assigned → accepted → en_route → on_site → completed; cancel from any active state) | admin, team responder |
| Dashboard | `GET /dashboard/summary`, `/dashboard/incidents`, `/dashboard/shelters`, `/dashboard/operations` | admin, responder |
| Health | `GET /health/live`, `GET /health/ready` (also under `/api/v1/health`) | public |

**SOS priority** is a transparent rule set (`src/modules/incidents/priority.ts`, overridable via `PRIORITY_CONFIG_JSON`): life-threatening 30, trapped 15, medical 15, people `4·log2(n)` (max 12), children 5, elderly 5, disabled 6, emergency type 0–12, verified hazards within 300 m 4 each (max 8), waiting time 1 per 10 min (max 10). Score is capped at 100: critical ≥70, high ≥45, medium ≥25, otherwise low. Every response includes the `priorityBreakdown`. Facts that were not reported score 0. Operators can override the result, and the reason is written to the audit log.

**Realtime (Socket.IO, path `/socket.io`).** Connect with `auth: { token }` (omit for anonymous). Every event has the payload `{ eventId, type, timestamp, entityId, status?, graphVersion?, data }`.

| Event | Rooms |
|---|---|
| `road.status.updated` (includes `graphVersion`) | `admins`, `public` |
| `hazard.reported` | `admins` |
| `hazard.verified` (also used for resolved) | `admins` (+ `public` when verified/resolved) |
| `route.invalidated` | `route:<routeRecordId>`, `user:<requesterId>` |
| `shelter.occupancy.updated` | `admins`, `public` |
| `sos.created` | `admins` (never public) |
| `mission.assigned`, `mission.status.updated` | `admins`, `team:<teamId>` |

Sockets auto-join `public`, `user:<id>`, `admins` (admin) and `team:<id>` (responder). To join other rooms, emit `subscribe {room}`. The ack is `{ok, error?}`. `route:<uuid>` is open to anyone who holds the id. `team:` rooms are limited to admins and members of that team. Events are emitted only after the DB commit. Events missed while disconnected are not replayed, so on reconnect clients should refetch REST state and compare `graphVersion`.

**Demo accounts** (`npm run seed:demo`; password `SEED_DEMO_PASSWORD`, default `suraksha-demo`, dev only): `admin@suraksha.demo`, `citizen@suraksha.demo`, and one responder per team: `ndrf-1@`, `sdrf-2@`, `boat-3@`, `med-4@`, `civ-5@suraksha.demo`.

**Data provenance.** Roads come from OpenStreetMap. Shelters, hazards, flood risk, incidents and teams are simulated for this demo.

## Verification (actual results on this repository)

| Check | Result |
|---|---|
| Routing engine `uv run pytest -q` | 38 passed (algorithms vs NetworkX reference on random and real graphs, Yen vs `shortest_simple_paths`, snapping, policies, versioning, API) |
| API `npm test` (vitest, in-process PostGIS) | 48 passed in 7 files (auth/RBAC, validation, reservation concurrency, missions state machine, hazards + audit, road closure + graph bump + invalidation, SOS priority + idempotency, routing client, Socket.IO rooms) |
| API `npm run typecheck` | clean |
| `npm run demo` against the real stack (devdb + engine + API) | 26/26 checks passed: route → admin blocks an edge on it → v2→v3 → `route.invalidated` delivered → new route avoids the edge → SOS → `sos.created` (admins only) → assignment → responder lifecycle → SOS resolved |
| Routing benchmark (`scripts/benchmark.py 30`, seeded graph 4,564 nodes / 5,763 edges, one Windows laptop) | graph load 172 ms; walking p50 176 ms / p95 253 ms; driving p50 207 ms / p95 357 ms; 60/60 `ok` |

## Known limitations

- **Docker Compose and Dockerfiles were not built or run here** (no Docker on the development machine). Everything else was verified with the PGlite PostGIS stand-in, which serialises connections, so true concurrent-transaction behaviour on server Postgres relies on the row locks + CHECK constraints (tested) rather than an observed multi-session run.
- Flood/access risks, closures, shelters, teams and incidents are simulated. Only road topology/geometry is real (OSM).
- Travel times use nominal speeds per road class; no live traffic, water depth or time-dependent flooding.
- Alternative generation is bounded (top 4 shelters × up to 6 paths, 5 s budget). Under that budget it returns what it found and says so.
- Route records expire after 30 min (evaluated on read); there is no reservation cancel/check-in endpoint yet; anonymous SOS senders get no tracking token.
- Rescue-team positions are their base locations; there is no live tracking.
