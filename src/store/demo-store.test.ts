import { beforeEach, describe, expect, it } from "vitest";
import { useDemoStore } from "./demo-store";
import { computeMetrics } from "@/lib/metrics";

const s = () => useDemoStore.getState();
const loc = { coordinates: [85.9, 26.15] as [number, number], area: "Test", district: "Darbhanga" };

describe("demo store", () => {
  beforeEach(() => s().resetDemo());

  it("SOS creates a new incident visible to the admin queue and metrics", () => {
    const before = computeMetrics(s()).activeIncidents;
    const inc = s().submitSOS({ location: loc, type: "stranded", peopleAffected: 6, medicalNeeded: false, notes: "x" });
    expect(s().incidents[0].id).toBe(inc.id);
    expect(inc).toMatchObject({ status: "new", priority: "high", source: "citizen_sos" });
    expect(computeMetrics(s()).activeIncidents).toBe(before + 1);
  });

  it("assigning a team creates a mission and marks the team busy", () => {
    const inc = s().submitSOS({ location: loc, type: "medical", peopleAffected: 1, medicalNeeded: true, notes: "" });
    s().assignRescueTeam(inc.id, "team-civ-5");
    const mission = s().missions.find((m) => m.incidentId === inc.id)!;
    expect(mission).toMatchObject({ teamId: "team-civ-5", status: "assigned" });
    expect(s().teams.find((t) => t.id === "team-civ-5")!.availability).toBe("on_mission");
    expect(s().incidents.find((i) => i.id === inc.id)).toMatchObject({ status: "assigned", assignedTeamId: "team-civ-5" });
  });

  it("mission status propagates to the incident and frees the team on completion", () => {
    const inc = s().submitSOS({ location: loc, type: "stranded", peopleAffected: 2, medicalNeeded: false, notes: "" });
    s().assignRescueTeam(inc.id, "team-civ-5");
    const id = s().missions.find((m) => m.incidentId === inc.id)!.id;
    s().updateMissionStatus(id, "en_route");
    expect(s().incidents.find((i) => i.id === inc.id)!.status).toBe("en_route");
    s().updateMissionStatus(id, "completed");
    expect(s().incidents.find((i) => i.id === inc.id)!.status).toBe("resolved");
    expect(s().teams.find((t) => t.id === "team-civ-5")!.availability).toBe("available");
  });

  it("incident status changes route through the active mission", () => {
    s().updateIncidentStatus("INC-1042", "on_site");
    expect(s().missions.find((m) => m.id === "MSN-302")!.status).toBe("on_site");
  });

  it("shelter edits clamp occupancy to capacity", () => {
    s().updateShelter("shl-donar", { occupancy: 9999 });
    const sh = s().shelters.find((x) => x.id === "shl-donar")!;
    expect(sh.occupancy).toBe(sh.capacity);
  });

  it("hazard reports start unverified", () => {
    expect(s().submitHazardReport({ location: loc, type: "fallen_tree", severity: "low", description: "tree" }).review).toBe("unverified");
  });

  it("reset restores seed data", () => {
    s().submitSOS({ location: loc, type: "other", peopleAffected: 1, medicalNeeded: false, notes: "" });
    s().resetDemo();
    expect(s().incidents.some((i) => i.source === "citizen_sos")).toBe(false);
  });
});
