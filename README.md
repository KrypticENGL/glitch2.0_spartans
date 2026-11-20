# SURAKSHA — Flood Evacuation & Rescue Coordination (frontend)

A frontend-only demonstration of a flood-response platform for **Darbhanga, Bihar**, with three experiences:

| Experience | Routes | What it does |
|---|---|---|
| Citizen (mobile-first) | `/`, `/shelters`, `/evacuation`, `/sos`, `/reports`, `/alerts` | Find shelters on a 3D map, compare evacuation routes, send a demo SOS, report road hazards |
| Operations dashboard | `/dashboard`, `/dashboard/map`, `/dashboard/incidents`, `/dashboard/rescue`, `/dashboard/shelters`, `/dashboard/analytics` | Monitor incidents, shelters and roads; assign teams; update statuses; edit shelter occupancy |
| Rescue responder (mobile) | `/responder` | See assigned missions, route preview, and advance mission status |

> **Demonstration mode.** All shelters, incidents, teams, alerts and road conditions are fictional. SOS requests are **not** sent to any emergency service. Routes are illustrative and not officially validated. In a real emergency in India, call **112**.

## Run it

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev        # http://localhost:3000
```

No API keys or environment variables are needed: the map uses keyless public providers (below). Without internet access the app still works, but basemap and terrain tiles do not load. The UI shows a notice, and every list and form stays usable.

| Script | Purpose |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js dev, production build, production server |
| `npm test` | Vitest unit tests (store transitions, routing classification, form validation) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript) |

`predev`/`prebuild` copy MapLibre's web worker into `public/` (see *Map* below). The copy is git-ignored.

## Stack

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · MapLibre GL JS 6 · Zustand · Lucide · Vitest.

## Architecture

```
src/
├── app/                    routes; (citizen) route group has its own shell
├── components/
│   ├── maps/               MapLibre wrapper, layers, controls, side panel / bottom sheet
│   ├── shelters/ evacuation/ citizen/ incidents/ dashboard/ responder/ layout/ shared/
│   └── ui/                 shadcn/ui primitives (themed in app/globals.css)
├── config/geo.ts           single geographic config: region, camera, basemaps, terrain source
├── data/mock/              seed data + generated OSM route geometry (routes.generated.json)
├── features/               routing adapter, shelter selectors, rescue legs, validation
├── services/api.ts         typed service boundary (getShelters, submitSOS, assignRescueTeam, …)
├── store/demo-store.ts     Zustand store, localStorage persistence, reset
├── lib/                    formatting, labels (i18n-ready), derived metrics
└── types/                  domain model
```

- **One source of truth.** Every screen reads the same Zustand store. An SOS appears in the incident queue; assigning a team creates a mission in the responder app; mission status changes propagate to the incident and to team availability. Dashboard numbers are derived (`lib/metrics.ts`), never hardcoded.
- **Persistence.** Demo state is saved to `localStorage` and rehydrated after mount, so server HTML and the first client render match. **Reset demo data** (dashboard header) restores the seed scenario.
- **Backend-ready.** `services/api.ts` exposes async, typed methods. To integrate a backend, keep the signatures and swap the bodies for `fetch` calls.
- **Hindi-ready text.** Enum labels live in `lib/format.ts` (`L`) so a translation dictionary can replace them.

## Map

- **Renderer:** MapLibre GL JS, loaded client-only via `next/dynamic` (`ssr: false`), initialised once per mount, cleaned up on unmount, resized with a `ResizeObserver`.
- **Basemaps:** [OpenFreeMap](https://openfreemap.org) styles *Liberty*, *Positron*, *Dark*. Free, keyless, attribution included in the style.
- **3D buildings:** `fill-extrusion` from the OpenMapTiles `building` layer using `render_height`. Buildings with no height data are drawn flat, never given an invented height.
- **Terrain:** [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium) at 1× (not exaggerated). The Mithila plain is nearly flat, so relief is subtle. A failing DEM source disables terrain without breaking the map.
- **Controls:** zoom, rotate, reset north, 2D/3D toggle, reset camera, go to demo location, basemap switcher, building and terrain toggles. Fly-to and fit-bounds respect `prefers-reduced-motion`.
- **Data layers** are GeoJSON sources (no DOM marker per feature): shelters, incidents, teams, hazard reports, road conditions, routes. Selection works both ways: list ↔ map.
- **Worker:** MapLibre v6 loads its worker from a sibling file that bundlers do not emit, so `scripts/copy-maplibre-worker.mjs` copies it to `public/` and the app calls `setWorkerUrl`.

## Demo data and routing limitations

- Shelters, incidents, teams and alerts are fictional and labelled *Simulated*. Locality names are real Darbhanga neighbourhoods; positions are approximate.
- Route geometry was generated **once** from the public OSRM demo server over OpenStreetMap roads (`node scripts/generate-routes.mjs`) and stored in `src/data/mock/routes.generated.json`. The app never calls a routing service.
- Road closures (`data/mock/road-segments.ts`) are simulated slices of those roads. `features/routing/adapter.ts` classifies routes with a simple, transparent rule: *Unavailable* if a route passes a blocked or flooded segment, *Caution* if it passes a caution segment, otherwise the fastest is *Recommended* and the rest are *Alternative*. This is **not** validated disaster-aware routing. Travel times are normal-traffic estimates.
- New missions created in the demo have no prepared road route; the map shows a dashed straight bearing line labelled as such.
- Citizen hazard reports stay *Unverified* until an operator reviews them, and never change road status on their own.
- Responder positions are shown at team bases; live tracking is not simulated.
- The Dribbble *OutletBuddy* reference was not reviewed during implementation; the shelter locator follows the written design brief (map-first layout, floating panel, cards ↔ markers).
