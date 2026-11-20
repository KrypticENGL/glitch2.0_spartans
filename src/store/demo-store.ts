import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  GeographicLocation,
  HazardReport,
  HazardReview,
  HazardSeverity,
  HazardType,
  Incident,
  IncidentStatus,
  IncidentType,
  MissionStatus,
  Priority,
  RescueMission,
  RescueTeam,
  Shelter,
} from "@/types";
import { SEED_HAZARDS, SEED_INCIDENTS, SEED_MISSIONS, SEED_SHELTERS, SEED_TEAMS } from "@/data/mock/seed";

export interface SOSPayload {
  location: GeographicLocation;
  type: IncidentType;
  peopleAffected: number;
  medicalNeeded: boolean;
  notes: string;
  contact?: string;
}

export interface HazardPayload {
  location: GeographicLocation;
  type: HazardType;
  severity: HazardSeverity;
  description: string;
  imageName?: string;
}

interface DemoData {
  shelters: Shelter[];
  incidents: Incident[];
  teams: RescueTeam[];
  missions: RescueMission[];
  hazards: HazardReport[];
  seq: number;
}

interface DemoActions {
  updateShelter: (id: string, patch: Partial<Pick<Shelter, "occupancy" | "capacity" | "status">>) => void;
  submitSOS: (payload: SOSPayload, now?: Date) => Incident;
  submitHazardReport: (payload: HazardPayload, now?: Date) => HazardReport;
  reviewHazard: (id: string, review: HazardReview) => void;
  assignRescueTeam: (incidentId: string, teamId: string, now?: Date) => void;
  updateIncidentStatus: (incidentId: string, status: IncidentStatus, now?: Date) => void;
  updateIncidentPriority: (incidentId: string, priority: Priority) => void;
  updateMissionStatus: (missionId: string, status: MissionStatus, now?: Date) => void;
  resetDemo: () => void;
}

export type DemoState = DemoData & DemoActions;

const noopStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const seed = (): DemoData => structuredClone({
  shelters: SEED_SHELTERS,
  incidents: SEED_INCIDENTS,
  teams: SEED_TEAMS,
  missions: SEED_MISSIONS,
  hazards: SEED_HAZARDS,
  seq: 1,
});

export const MISSION_TO_INCIDENT: Record<MissionStatus, IncidentStatus> = {
  assigned: "assigned",
  accepted: "assigned",
  en_route: "en_route",
  on_site: "on_site",
  completed: "resolved",
};

export const MISSION_FLOW: MissionStatus[] = ["assigned", "accepted", "en_route", "on_site", "completed"];

const priorityFor = (p: SOSPayload): Priority =>
  p.medicalNeeded || p.type === "medical" || p.type === "structure_collapse" ? "critical" : p.peopleAffected >= 5 ? "high" : "medium";

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      ...seed(),

      updateShelter: (id, patch) =>
        set((s) => ({
          shelters: s.shelters.map((sh) => {
            if (sh.id !== id) return sh;
            const capacity = Math.max(0, Math.round(patch.capacity ?? sh.capacity));
            const occupancy = Math.min(capacity, Math.max(0, Math.round(patch.occupancy ?? sh.occupancy)));
            return { ...sh, ...patch, capacity, occupancy };
          }),
        })),

      submitSOS: (p, now = new Date()) => {
        const n = get().seq;
        const incident: Incident = {
          id: `SOS-${String(n).padStart(3, "0")}`,
          type: p.type,
          priority: priorityFor(p),
          status: "new",
          location: p.location,
          reportedAt: now.toISOString(),
          peopleAffected: p.peopleAffected,
          medicalNeeded: p.medicalNeeded,
          notes: p.notes,
          contact: p.contact || undefined,
          source: "citizen_sos",
        };
        set((s) => ({ incidents: [incident, ...s.incidents], seq: s.seq + 1 }));
        return incident;
      },

      submitHazardReport: (p, now = new Date()) => {
        const n = get().seq;
        const report: HazardReport = { id: `HZ-C${n}`, ...p, reportedAt: now.toISOString(), review: "unverified" };
        set((s) => ({ hazards: [report, ...s.hazards], seq: s.seq + 1 }));
        return report;
      },

      reviewHazard: (id, review) => set((s) => ({ hazards: s.hazards.map((h) => (h.id === id ? { ...h, review } : h)) })),

      assignRescueTeam: (incidentId, teamId, now = new Date()) =>
        set((s) => {
          const incident = s.incidents.find((i) => i.id === incidentId);
          const team = s.teams.find((t) => t.id === teamId);
          if (!incident || !team || incident.status === "resolved") return s;
          const ts = now.toISOString();
          // Reassignment: close the previous active mission and free its team.
          const prev = s.missions.find((m) => m.incidentId === incidentId && m.status !== "completed");
          const missions = s.missions.filter((m) => m !== prev);
          const id = `MSN-${400 + s.seq}`;
          missions.unshift({ id, incidentId, teamId, status: "assigned", createdAt: ts, updatedAt: ts });
          const busy = new Set(missions.filter((m) => m.status !== "completed").map((m) => m.teamId));
          return {
            seq: s.seq + 1,
            missions,
            incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, assignedTeamId: teamId, status: "assigned" } : i)),
            teams: s.teams.map((t) =>
              t.availability === "off_duty" ? t : { ...t, availability: busy.has(t.id) ? "on_mission" : "available" },
            ),
          };
        }),

      updateMissionStatus: (missionId, status, now = new Date()) =>
        set((s) => {
          const mission = s.missions.find((m) => m.id === missionId);
          if (!mission) return s;
          const missions = s.missions.map((m) => (m.id === missionId ? { ...m, status, updatedAt: now.toISOString() } : m));
          const busy = new Set(missions.filter((m) => m.status !== "completed").map((m) => m.teamId));
          return {
            missions,
            incidents: s.incidents.map((i) => (i.id === mission.incidentId ? { ...i, status: MISSION_TO_INCIDENT[status] } : i)),
            teams: s.teams.map((t) =>
              t.id === mission.teamId && t.availability !== "off_duty" ? { ...t, availability: busy.has(t.id) ? "on_mission" : "available" } : t,
            ),
          };
        }),

      updateIncidentStatus: (incidentId, status, now) => {
        const mission = get().missions.find((m) => m.incidentId === incidentId && m.status !== "completed");
        if (mission) {
          // Keep incident and mission in lockstep: route the change through the mission.
          const ms: MissionStatus = status === "resolved" ? "completed" : status === "new" ? "assigned" : status;
          get().updateMissionStatus(mission.id, ms, now);
        } else {
          set((s) => ({ incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, status } : i)) }));
        }
      },

      updateIncidentPriority: (incidentId, priority) =>
        set((s) => ({ incidents: s.incidents.map((i) => (i.id === incidentId ? { ...i, priority } : i)) })),

      resetDemo: () => set(seed()),
    }),
    {
      name: "suraksha-demo-v1",
      // Node 25 exposes a non-functional global localStorage, so gate on window (SSR and tests use a no-op).
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      // Rehydrated manually after mount so server HTML and first client render match.
      skipHydration: true,
      partialize: ({ shelters, incidents, teams, missions, hazards, seq }) => ({ shelters, incidents, teams, missions, hazards, seq }),
    },
  ),
);
