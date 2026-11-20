## API (backend/api)

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
