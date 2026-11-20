import type { EvacuationRoute, LngLat, RoadSegment, RouteClassification } from "@/types";
import { geo, type RawRoute } from "@/data/mock/geo";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";

// Mock routing adapter. Geometry is pre-generated from OSM via OSRM (scripts/generate-routes.mjs);
// classification below is a simple rule over SIMULATED road conditions, not validated disaster-aware routing.

const R = 6371000;
export function distanceM(a: LngLat, b: LngLat): number {
  const x = ((b[0] - a[0]) * Math.PI) / 180 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const y = ((b[1] - a[1]) * Math.PI) / 180;
  return Math.hypot(x, y) * R;
}

/** A route "uses" a segment when at least 3 of its vertices lie on the segment (shared OSM nodes). */
export function routeUsesSegment(route: LngLat[], segment: LngLat[], toleranceM = 12): boolean {
  let hits = 0;
  for (const p of route) {
    if (segment.some((q) => distanceM(p, q) <= toleranceM) && ++hits >= 3) return true;
  }
  return false;
}

const RANK: Record<RouteClassification, number> = { recommended: 0, alternative: 1, caution: 2, unavailable: 3 };

export function classifyRoutes(
  shelterId: string,
  raw: RawRoute[],
  segments: RoadSegment[],
): EvacuationRoute[] {
  const assessed = raw.map((r, i) => {
    const affected = segments.filter((s) => s.condition !== "open" && routeUsesSegment(r.coordinates, s.coordinates));
    const impassable = affected.filter((s) => s.condition === "blocked" || s.condition === "flooded");
    return { r, i, affected, impassable };
  });

  // Fastest open route is recommended; other open routes are alternatives.
  const open = assessed.filter((a) => a.affected.length === 0).sort((a, b) => a.r.durationS - b.r.durationS);
  const recommendedIdx = open[0]?.i;

  return assessed
    .map(({ r, i, affected, impassable }): EvacuationRoute => {
      let classification: RouteClassification;
      let rationale: string;
      if (impassable.length) {
        classification = "unavailable";
        rationale = `Passes ${impassable.map((s) => s.name).join(", ")} (${impassable[0].condition}).`;
      } else if (affected.length) {
        classification = "caution";
        rationale = `Passable with care: ${affected.map((s) => s.note.toLowerCase()).join("; ")}`;
      } else if (i === recommendedIdx) {
        classification = "recommended";
        rationale = "Shortest travel time among routes with no reported closures or water on the way.";
      } else {
        classification = "alternative";
        rationale = "No reported closures, but slower than the recommended route.";
      }
      return {
        id: `${shelterId}#${i}`,
        shelterId,
        label: `Route ${String.fromCharCode(65 + i)}`,
        distanceM: r.distanceM,
        durationS: r.durationS,
        coordinates: r.coordinates,
        classification,
        affectedSegmentIds: affected.map((s) => s.id),
        rationale,
      };
    })
    .sort((a, b) => RANK[a.classification] - RANK[b.classification] || a.durationS - b.durationS);
}

export function getRoutesToShelter(shelterId: string): EvacuationRoute[] {
  const raw = geo.shelterRoutes[shelterId];
  return raw ? classifyRoutes(shelterId, raw, ROAD_SEGMENTS) : [];
}

/** Shortest-route distance from the demo origin to each shelter (used for "distance" on cards). */
export function shelterDistanceM(shelterId: string): number | undefined {
  const routes = getRoutesToShelter(shelterId);
  const usable = routes.find((r) => r.classification !== "unavailable") ?? routes[0];
  return usable?.distanceM;
}
