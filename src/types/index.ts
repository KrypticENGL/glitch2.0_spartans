// Domain model for SURAKSHA. Coordinates are always GeoJSON order: [longitude, latitude].
export type LngLat = [lng: number, lat: number];

export interface GeographicLocation {
  coordinates: LngLat;
  area: string;
  district: string;
  address?: string;
}

export type ShelterFacility = "water" | "medical" | "food" | "power" | "accessible" | "sanitation";

export type ShelterStatus = "open" | "near_capacity" | "full" | "closed";

export interface Shelter {
  id: string;
  name: string;
  kind: string;
  location: GeographicLocation;
  capacity: number;
  occupancy: number;
  facilities: ShelterFacility[];
  accessibilityNotes: string;
  status: ShelterStatus;
  contact?: { name: string; phone: string };
  /** Always true in this build: shelters are fictional demo records. */
  simulated: true;
}

export type RoadCondition = "open" | "caution" | "flooded" | "blocked";

export interface RoadSegment {
  id: string;
  name: string;
  condition: RoadCondition;
  note: string;
  coordinates: LngLat[];
  verified: boolean;
}

export type RouteClassification = "recommended" | "alternative" | "caution" | "unavailable";

export interface EvacuationRoute {
  id: string;
  shelterId: string;
  label: string;
  distanceM: number;
  durationS: number;
  coordinates: LngLat[];
  classification: RouteClassification;
  /** Road segments this route passes through that are not open. */
  affectedSegmentIds: string[];
  rationale: string;
}

export type IncidentType = "stranded" | "medical" | "structure_collapse" | "missing_person" | "supplies" | "other";
export type Priority = "critical" | "high" | "medium" | "low";
export type IncidentStatus = "new" | "assigned" | "en_route" | "on_site" | "resolved";

export interface Incident {
  id: string;
  type: IncidentType;
  priority: Priority;
  status: IncidentStatus;
  location: GeographicLocation;
  reportedAt: string; // ISO
  peopleAffected: number;
  medicalNeeded: boolean;
  notes: string;
  contact?: string;
  assignedTeamId?: string;
  source: "seed" | "citizen_sos";
}

export type TeamKind = "NDRF" | "SDRF" | "Boat" | "Medical" | "Civil Defence";
export type TeamAvailability = "available" | "on_mission" | "off_duty";

export interface RescueTeam {
  id: string;
  name: string;
  kind: TeamKind;
  members: number;
  base: GeographicLocation;
  availability: TeamAvailability;
  lead: { name: string; phone: string };
  equipment: string[];
}

export type MissionStatus = "assigned" | "accepted" | "en_route" | "on_site" | "completed";

export interface RescueMission {
  id: string;
  incidentId: string;
  teamId: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
}

export type AlertSeverity = "severe" | "warning" | "advisory";

export interface EmergencyAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  area: string;
  issuedAt: string;
}

export type HazardType = "waterlogging" | "road_damage" | "fallen_tree" | "bridge_issue" | "power_line" | "other";
export type HazardSeverity = "low" | "moderate" | "severe";
export type HazardReview = "unverified" | "verified" | "dismissed";

export interface HazardReport {
  id: string;
  type: HazardType;
  severity: HazardSeverity;
  description: string;
  location: GeographicLocation;
  reportedAt: string;
  imageName?: string;
  review: HazardReview;
}
