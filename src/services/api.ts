// Typed service boundary. Today every method resolves against local demo state (no network).
// To integrate a backend, keep these signatures and swap the bodies for fetch calls.
import type { EvacuationRoute, Incident, IncidentStatus, MissionStatus, RescueTeam, Shelter, HazardReport } from "@/types";
import { useDemoStore, type HazardPayload, type SOSPayload } from "@/store/demo-store";
import { getRoutesToShelter } from "@/features/routing/adapter";

const state = () => useDemoStore.getState();

export const api = {
  getShelters: async (): Promise<Shelter[]> => state().shelters,
  getIncidents: async (): Promise<Incident[]> => state().incidents,
  getRescueTeams: async (): Promise<RescueTeam[]> => state().teams,
  /** Origin is fixed to the demo location; only pre-generated destinations are routable. */
  getRoutes: async (_origin: "demo-origin", shelterId: string): Promise<EvacuationRoute[]> => getRoutesToShelter(shelterId),
  submitSOS: async (payload: SOSPayload): Promise<Incident> => state().submitSOS(payload),
  submitHazardReport: async (payload: HazardPayload): Promise<HazardReport> => state().submitHazardReport(payload),
  assignRescueTeam: async (incidentId: string, teamId: string): Promise<void> => state().assignRescueTeam(incidentId, teamId),
  updateIncidentStatus: async (incidentId: string, status: IncidentStatus): Promise<void> => state().updateIncidentStatus(incidentId, status),
  updateMissionStatus: async (missionId: string, status: MissionStatus): Promise<void> => state().updateMissionStatus(missionId, status),
};
