import type { DemoState } from "@/store/demo-store";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";

/** All dashboard numbers derive from the shared demo state — never hardcoded. */
export function computeMetrics(s: Pick<DemoState, "shelters" | "incidents" | "missions" | "teams">) {
  const active = s.incidents.filter((i) => i.status !== "resolved");
  const operating = s.shelters.filter((sh) => sh.status !== "closed");
  const capacity = operating.reduce((n, sh) => n + sh.capacity, 0);
  const occupancy = operating.reduce((n, sh) => n + sh.occupancy, 0);
  const impassable = ROAD_SEGMENTS.filter((r) => r.condition === "blocked" || r.condition === "flooded").length;
  return {
    activeIncidents: active.length,
    criticalIncidents: active.filter((i) => i.priority === "critical").length,
    unassignedIncidents: active.filter((i) => !i.assignedTeamId).length,
    peopleAwaiting: active.reduce((n, i) => n + i.peopleAffected, 0),
    sosRequests: s.incidents.filter((i) => i.source === "citizen_sos").length,
    sheltersAccepting: s.shelters.filter((sh) => sh.status === "open" || sh.status === "near_capacity").length,
    sheltersTotal: s.shelters.length,
    capacity,
    occupancy,
    occupancyPct: capacity ? Math.round((occupancy / capacity) * 100) : 0,
    spaces: capacity - occupancy,
    roadsMonitored: ROAD_SEGMENTS.length,
    roadsImpassable: impassable,
    activeMissions: s.missions.filter((m) => m.status !== "completed").length,
    teamsAvailable: s.teams.filter((t) => t.availability === "available").length,
    teamsTotal: s.teams.length,
  };
}
