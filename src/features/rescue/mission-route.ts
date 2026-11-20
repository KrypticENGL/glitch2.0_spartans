import type { Incident, LngLat, RescueTeam } from "@/types";
import { MISSION_ROUTES } from "@/data/mock/seed";
import type { MapRoute } from "@/components/maps/map-types";
import { distanceM } from "@/features/routing/adapter";

export interface MissionLeg {
  route: MapRoute;
  /** True when we have a road-following path; false means a straight bearing line only. */
  onRoad: boolean;
  distanceM: number;
}

/** Road leg for seeded missions; for new assignments only a straight bearing line is honest. */
export function missionLeg(team: RescueTeam, incident: Incident): MissionLeg {
  const known = MISSION_ROUTES[`${team.id}:${incident.id}`];
  if (known) {
    return { onRoad: true, distanceM: known.distanceM, route: { id: `leg:${team.id}:${incident.id}`, label: "Suggested approach", classification: "recommended", coordinates: known.coordinates } };
  }
  const line: LngLat[] = [team.base.coordinates, incident.location.coordinates];
  return {
    onRoad: false,
    distanceM: Math.round(distanceM(line[0], line[1])),
    route: { id: `leg:${team.id}:${incident.id}`, label: "Straight line, not a road route", classification: "caution", coordinates: line },
  };
}
