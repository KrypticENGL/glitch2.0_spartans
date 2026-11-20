// Mirrors the PostgreSQL enums in database/migrations/001_init.sql.
export const USER_ROLES = ["citizen", "admin", "responder"] as const;
export const SHELTER_STATUSES = ["open", "near_capacity", "full", "closed"] as const;
export const ROAD_STATUSES = ["open", "restricted", "blocked", "unknown"] as const;
export const HAZARD_TYPES = ["waterlogging", "flooding", "road_damage", "fallen_tree", "bridge_issue", "power_line", "landslide", "other"] as const;
export const HAZARD_SEVERITIES = ["low", "moderate", "severe"] as const;
export const HAZARD_SOURCES = ["citizen", "admin", "official", "simulated"] as const;
export const HAZARD_VERIFICATIONS = ["unverified", "verified", "rejected", "resolved"] as const;
export const INCIDENT_TYPES = ["stranded", "medical", "structure_collapse", "missing_person", "supplies", "other"] as const;
export const PRIORITY_LEVELS = ["critical", "high", "medium", "low"] as const;
export const INCIDENT_STATUSES = ["new", "assigned", "en_route", "on_site", "resolved", "cancelled"] as const;
export const TEAM_AVAILABILITIES = ["available", "on_mission", "off_duty"] as const;
export const MISSION_STATUSES = ["assigned", "accepted", "en_route", "on_site", "completed", "cancelled"] as const;
export const RESERVATION_STATUSES = ["active", "checked_in", "cancelled", "expired"] as const;
export const ROUTE_RECORD_STATUSES = ["valid", "invalidated", "expired"] as const;
export const TRAVEL_MODES = ["walking", "driving"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type ShelterStatus = (typeof SHELTER_STATUSES)[number];
export type RoadStatus = (typeof ROAD_STATUSES)[number];
export type HazardVerification = (typeof HAZARD_VERIFICATIONS)[number];
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type MissionStatus = (typeof MISSION_STATUSES)[number];
export type TravelMode = (typeof TRAVEL_MODES)[number];
export type RouteRecordStatus = (typeof ROUTE_RECORD_STATUSES)[number];
