import type { TimelineEvent } from "@/types";
import { SEED_ALERTS, SEED_HAZARDS, SEED_INCIDENTS, SEED_SHELTERS } from "./seed";
import { HISTORICAL_RISK } from "./historical-risk";
import { ROAD_SEGMENTS } from "./road-segments";

const riskEvents: TimelineEvent[] = HISTORICAL_RISK.map((observation) => ({
  id: `event-${observation.id}`,
  timestamp: observation.timestamp,
  kind: observation.source === "simulation" ? "risk" : observation.source === "official_warning" ? "alert" : "hazard",
  title: observation.source === "simulation" ? "Modeled risk observation" : observation.sourceLabel,
  summary: observation.summary,
  area: observation.area,
  coordinates: [observation.longitude, observation.latitude],
  entityKind: "risk",
  entityId: observation.id,
  source: observation.source,
}));

const hazardEvents: TimelineEvent[] = SEED_HAZARDS.map((hazard) => ({
  id: `event-${hazard.id}`,
  timestamp: hazard.reportedAt,
  kind: "hazard",
  title: "Citizen hazard report",
  summary: hazard.description,
  area: hazard.location.area,
  coordinates: hazard.location.coordinates,
  entityKind: "hazard",
  entityId: hazard.id,
  source: "citizen_report",
}));

const roadEvents: TimelineEvent[] = ROAD_SEGMENTS.flatMap((road) => road.reportedAt ? [{
  id: `event-${road.id}`,
  timestamp: road.reportedAt,
  kind: "road" as const,
  title: road.condition === "blocked" && road.verified ? "Verified road closure" : "Road condition report",
  summary: `${road.name}: ${road.note}`,
  area: road.name,
  coordinates: road.coordinates[Math.floor(road.coordinates.length / 2)] ?? [85.9, 26.15],
  entityKind: "road" as const,
  entityId: road.id,
  source: road.verified ? "verified_observation" as const : "citizen_report" as const,
}] : []);

const incidentEvents: TimelineEvent[] = SEED_INCIDENTS.map((incident) => ({
  id: `event-${incident.id}`,
  timestamp: incident.reportedAt,
  kind: "incident",
  title: incident.source === "citizen_sos" ? "SOS request" : "Incident report",
  summary: `${incident.peopleAffected} ${incident.peopleAffected === 1 ? "person" : "people"} · ${incident.notes || "No additional notes."}`,
  area: incident.location.area,
  coordinates: incident.location.coordinates,
  entityKind: "incident",
  entityId: incident.id,
  source: incident.source === "citizen_sos" ? "citizen_report" : "simulation",
}));

const alertEvents: TimelineEvent[] = SEED_ALERTS.map((alert) => {
  const shelter = SEED_SHELTERS.find((item) => alert.area.toLowerCase().includes(item.location.area.toLowerCase()));
  return {
    id: `event-${alert.id}`,
    timestamp: alert.issuedAt,
    kind: "alert",
    title: "District warning (simulated)",
    summary: alert.title,
    area: alert.area,
    coordinates: shelter?.location.coordinates ?? [85.9, 26.15],
    entityKind: "alert",
    entityId: alert.id,
    source: "official_warning",
  };
});

// This is a fixed end-of-scenario capacity snapshot, not a claim that a change occurred at this time.
const shelterEvents: TimelineEvent[] = SEED_SHELTERS.map((shelter) => ({
  id: `event-snapshot-${shelter.id}`,
  timestamp: "2026-08-14T07:30:00Z", // 13:00 IST
  kind: "shelter",
  title: "Shelter capacity snapshot",
  summary: `${shelter.name}: ${shelter.status.replace("_", " ")}, ${Math.max(0, shelter.capacity - shelter.occupancy)} spaces available of ${shelter.capacity}.`,
  area: shelter.location.area,
  coordinates: shelter.location.coordinates,
  entityKind: "shelter",
  entityId: shelter.id,
  source: "simulation",
}));

/** All events are attached to seeded demonstration records and the scenario has a fixed date. */
export const TIMELINE_EVENTS: TimelineEvent[] = [...riskEvents, ...hazardEvents, ...roadEvents, ...incidentEvents, ...alertEvents, ...shelterEvents]
  .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));

export const DEMO_TIMELINE_START = Date.parse("2026-08-14T02:30:00Z"); // 08:00 IST
export const DEMO_TIMELINE_END = Date.parse("2026-08-14T07:30:00Z"); // 13:00 IST
