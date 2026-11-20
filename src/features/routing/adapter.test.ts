import { describe, expect, it } from "vitest";
import { classifyRoutes, getRoutesToShelter, routeUsesSegment } from "./adapter";
import { SEED_SHELTERS } from "@/data/mock/seed";
import type { LngLat, RoadSegment } from "@/types";

const line: LngLat[] = [[85.9, 26.1], [85.9001, 26.1], [85.9002, 26.1], [85.9003, 26.1]];

describe("routing adapter", () => {
  it("detects shared road vertices but not a single crossing point", () => {
    expect(routeUsesSegment(line, line.slice(0, 3))).toBe(true);
    expect(routeUsesSegment(line, [line[0], [85.95, 26.2]])).toBe(false);
  });

  it("marks blocked routes unavailable and picks the fastest open route", () => {
    const seg: RoadSegment = { id: "s", name: "Test", condition: "blocked", note: "", coordinates: line, verified: true };
    const far: LngLat[] = line.map(([x, y]) => [x, y + 0.01]);
    const routes = classifyRoutes("x", [
      { distanceM: 100, durationS: 60, coordinates: line },
      { distanceM: 200, durationS: 120, coordinates: far },
      { distanceM: 300, durationS: 180, coordinates: far.map(([x, y]) => [x + 0.01, y]) },
    ], [seg]);
    expect(routes.map((r) => r.classification)).toEqual(["recommended", "alternative", "unavailable"]);
  });

  it("every demo shelter has routes and at most one recommendation", () => {
    for (const sh of SEED_SHELTERS) {
      const routes = getRoutesToShelter(sh.id);
      expect(routes.length).toBeGreaterThanOrEqual(2);
      expect(routes.filter((r) => r.classification === "recommended").length).toBeLessThanOrEqual(1);
    }
  });

  it("the seeded underpass closure makes a Laheriasarai route unavailable", () => {
    expect(getRoutesToShelter("shl-laheriasarai").some((r) => r.classification === "unavailable")).toBe(true);
  });
});
