import type { Map as MLMap, GeoJSONSource, AddLayerObject, ExpressionSpecification } from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import { L, TONE_HEX, spacesLeft, tone } from "@/lib/format";
import { TERRAIN_SOURCE } from "@/config/geo";
import type { MapLayerKey, SurakshaMapProps } from "./map-types";

// Pure MapLibre plumbing: sources, layers and data sync. No React here.

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const NAVY = "#0E2235";

type Props = Omit<SurakshaMapProps, "label">;

const fc = (features: FeatureCollection["features"]): FeatureCollection => ({ type: "FeatureCollection", features });
const feat = (geometry: Geometry, properties: Record<string, unknown>) => ({ type: "Feature" as const, geometry, properties });

export function buildData(p: Props): Record<string, FeatureCollection> {
  const sel = p.selection;
  return {
    "src-shelters": fc(
      (p.shelters ?? []).map((s) =>
        feat({ type: "Point", coordinates: s.location.coordinates }, {
          id: s.id,
          name: s.name,
          spaces: s.status === "closed" ? "–" : String(spacesLeft(s)),
          color: TONE_HEX[tone.shelter[s.status]],
          selected: sel?.kind === "shelter" && sel.id === s.id,
        }),
      ),
    ),
    "src-incidents": fc(
      (p.incidents ?? []).map((i) =>
        feat({ type: "Point", coordinates: i.location.coordinates }, {
          id: i.id,
          color: TONE_HEX[tone.priority[i.priority]],
          resolved: i.status === "resolved",
          selected: sel?.kind === "incident" && sel.id === i.id,
          label: `${i.id} · ${L.priority[i.priority]}`,
        }),
      ),
    ),
    "src-teams": fc(
      (p.teams ?? []).map((t) =>
        feat({ type: "Point", coordinates: t.base.coordinates }, { id: t.id, name: t.name, selected: sel?.kind === "team" && sel.id === t.id }),
      ),
    ),
    "src-hazards": fc(
      (p.hazards ?? []).filter((h) => h.review !== "dismissed").map((h) =>
        feat({ type: "Point", coordinates: h.location.coordinates }, {
          id: h.id,
          verified: h.review === "verified",
          label: `${L.hazard[h.type]}${h.review === "verified" ? "" : " (unverified)"}`,
          selected: sel?.kind === "hazard" && sel.id === h.id,
        }),
      ),
    ),
    "src-roads": fc(
      (p.roads ?? []).filter((r) => r.condition !== "open").map((r) =>
        feat({ type: "LineString", coordinates: r.coordinates }, {
          id: r.id,
          condition: r.condition,
          label: `${L.road[r.condition]}: ${r.name}`,
          color: TONE_HEX[tone.road[r.condition]],
        }),
      ),
    ),
    "src-routes": fc(
      (p.routes ?? []).map((r) =>
        feat({ type: "LineString", coordinates: r.coordinates }, {
          id: r.id,
          classification: r.classification,
          selected: r.id === p.selectedRouteId,
          label: `${r.label} · ${L.route[r.classification]}`,
          color: TONE_HEX[tone.route[r.classification]],
        }),
      ),
    ),
    "src-origin": fc(p.origin ? [feat({ type: "Point", coordinates: p.origin.coordinates }, { label: p.origin.label })] : []),
  };
}

const ANY_SELECTED_ROUTE: ExpressionSpecification = ["==", ["get", "selected"], true];
const routeOpacity = (hasSelection: boolean): ExpressionSpecification | number =>
  hasSelection ? ["case", ANY_SELECTED_ROUTE, 1, 0.35] : 0.9;

function layers(hasSelectedRoute: boolean): (AddLayerObject & { group?: MapLayerKey })[] {
  const op = routeOpacity(hasSelectedRoute);
  return [
    // Road conditions
    { id: "roads-casing", type: "line", source: "src-roads", group: "roads", layout: { "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 } },
    { id: "roads-line", type: "line", source: "src-roads", group: "roads", paint: { "line-color": ["get", "color"], "line-width": 5, "line-dasharray": [1, 1] } },
    { id: "roads-label", type: "symbol", source: "src-roads", group: "roads", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 11, "text-offset": [0, -1.1] }, paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 1.6 } },
    // Routes: casing, then solid / dashed variants (dasharray is not data-driven, so split by filter)
    { id: "routes-casing", type: "line", source: "src-routes", group: "routes", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["case", ANY_SELECTED_ROUTE, 11, 7], "line-opacity": op } },
    { id: "routes-solid", type: "line", source: "src-routes", group: "routes", filter: ["in", ["get", "classification"], ["literal", ["recommended", "alternative"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ANY_SELECTED_ROUTE, 6.5, 4], "line-opacity": op } },
    { id: "routes-caution", type: "line", source: "src-routes", group: "routes", filter: ["==", ["get", "classification"], "caution"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ANY_SELECTED_ROUTE, 6, 4], "line-dasharray": [2, 1], "line-opacity": op } },
    { id: "routes-unavailable", type: "line", source: "src-routes", group: "routes", filter: ["==", ["get", "classification"], "unavailable"], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ANY_SELECTED_ROUTE, 5, 3.5], "line-dasharray": [0.8, 1.6], "line-opacity": op } },
    { id: "routes-label", type: "symbol", source: "src-routes", group: "routes", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12, "text-offset": [0, -1.2], "symbol-sort-key": ["case", ANY_SELECTED_ROUTE, 0, 1] }, paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 2, "text-opacity": op } },
    // Points
    { id: "hazards-circle", type: "circle", source: "src-hazards", group: "hazards", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": ["case", ["get", "selected"], 10, 7], "circle-color": ["case", ["get", "verified"], TONE_HEX.warn, "#ffffff"], "circle-stroke-color": TONE_HEX.warn, "circle-stroke-width": 2.5 } },
    { id: "hazards-label", type: "symbol", source: "src-hazards", group: "hazards", minzoom: 14, layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": "#7a4f08", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
    { id: "teams-circle", type: "circle", source: "src-teams", group: "teams", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": ["case", ["get", "selected"], 11, 8], "circle-color": NAVY, "circle-stroke-color": ["case", ["get", "selected"], TONE_HEX.info, "#ffffff"], "circle-stroke-width": ["case", ["get", "selected"], 4, 2] } },
    { id: "teams-label", type: "symbol", source: "src-teams", group: "teams", minzoom: 13.5, layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": NAVY, "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
    { id: "incidents-pulse", type: "circle", source: "src-incidents", group: "incidents", filter: ["==", ["get", "selected"], true], paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": 20, "circle-color": ["get", "color"], "circle-opacity": 0.18 } },
    { id: "incidents-circle", type: "circle", source: "src-incidents", group: "incidents", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": ["case", ["get", "selected"], 10, 7], "circle-color": ["case", ["get", "resolved"], "#ffffff", ["get", "color"]], "circle-stroke-color": ["case", ["get", "resolved"], TONE_HEX.ok, "#ffffff"], "circle-stroke-width": 2.5 } },
    { id: "incidents-label", type: "symbol", source: "src-incidents", group: "incidents", minzoom: 14, layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top" }, paint: { "text-color": NAVY, "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
    { id: "shelters-halo", type: "circle", source: "src-shelters", group: "shelters", filter: ["==", ["get", "selected"], true], paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": 26, "circle-color": TONE_HEX.info, "circle-opacity": 0.2, "circle-stroke-color": TONE_HEX.info, "circle-stroke-width": 2 } },
    { id: "shelters-circle", type: "circle", source: "src-shelters", group: "shelters", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": ["case", ["get", "selected"], 17, 14], "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
    { id: "shelters-count", type: "symbol", source: "src-shelters", group: "shelters", layout: { "text-field": ["get", "spaces"], "text-font": FONT_BOLD, "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": "#ffffff" } },
    { id: "shelters-label", type: "symbol", source: "src-shelters", group: "shelters", layout: { "text-field": ["get", "name"], "text-font": FONT_BOLD, "text-size": ["case", ["get", "selected"], 13, 11.5], "text-offset": [0, 1.8], "text-anchor": "top", "text-max-width": 9, "symbol-sort-key": ["case", ["get", "selected"], 0, 1] }, paint: { "text-color": NAVY, "text-halo-color": "#ffffff", "text-halo-width": 2 } },
    { id: "origin-ring", type: "circle", source: "src-origin", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": 16, "circle-color": "#2563eb", "circle-opacity": 0.16 } },
    { id: "origin-dot", type: "circle", source: "src-origin", paint: { "circle-pitch-scale": "viewport", "circle-pitch-alignment": "viewport", "circle-radius": 7, "circle-color": "#2563eb", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
    { id: "origin-label", type: "symbol", source: "src-origin", layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 11, "text-offset": [0, 1.5], "text-anchor": "top" }, paint: { "text-color": "#1d4ed8", "text-halo-color": "#ffffff", "text-halo-width": 2 } },
  ];
}

export const CLICKABLE: Record<string, "shelter" | "incident" | "team" | "hazard" | "route"> = {
  "shelters-circle": "shelter",
  "incidents-circle": "incident",
  "teams-circle": "team",
  "hazards-circle": "hazard",
  "routes-solid": "route",
  "routes-caution": "route",
  "routes-unavailable": "route",
};

// Buildings without any height data stay flat (0 m) rather than receiving an invented height.
const H: ExpressionSpecification = ["coalesce", ["get", "render_height"], 0];

/** Adds terrain DEM, 3D buildings and all app layers. Safe to call after every style load. */
export function installLayers(map: MLMap, p: Props, opts: { buildings: boolean }) {
  if (!map.getSource("terrain-dem")) {
    map.addSource("terrain-dem", { type: "raster-dem", tiles: TERRAIN_SOURCE.tiles, encoding: TERRAIN_SOURCE.encoding, tileSize: TERRAIN_SOURCE.tileSize, maxzoom: TERRAIN_SOURCE.maxzoom, attribution: TERRAIN_SOURCE.attribution });
  }

  // Replace the basemap's own extrusions (if any) with a single, quieter one.
  for (const l of map.getStyle().layers ?? []) if (l.type === "fill-extrusion") map.removeLayer(l.id);
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  if (map.getSource("openmaptiles") && !map.getLayer("buildings-3d")) {
    map.addLayer(
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        layout: { visibility: opts.buildings ? "visible" : "none" },
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], H, 0, "#d8dee5", 30, "#b9c4cf"],
          // Heights come from OSM via OpenMapTiles; the schema substitutes an estimate where OSM has none.
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, H],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.82,
        },
      },
      firstSymbol,
    );
  }

  const data = buildData(p);
  for (const [id, d] of Object.entries(data)) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: d });
  for (const layer of layers(!!p.selectedRouteId)) {
    if (map.getLayer(layer.id)) continue;
    const { group, ...spec } = layer;
    void group;
    map.addLayer(spec);
  }
  syncLayers(map, p);
}

export function syncLayers(map: MLMap, p: Props) {
  const data = buildData(p);
  for (const [id, d] of Object.entries(data)) (map.getSource(id) as GeoJSONSource | undefined)?.setData(d);
  const hasSel = !!p.selectedRouteId && (p.routes ?? []).some((r) => r.id === p.selectedRouteId);
  for (const layer of layers(hasSel)) {
    if (!map.getLayer(layer.id)) continue;
    if (layer.group) map.setLayoutProperty(layer.id, "visibility", p.visible?.[layer.group] === false ? "none" : "visible");
    if (layer.id.startsWith("routes-")) {
      const key = layer.type === "symbol" ? "text-opacity" : "line-opacity";
      map.setPaintProperty(layer.id, key, routeOpacity(hasSel));
    }
  }
}
