import type { LngLat } from "./index";

export type RiskSource = "verified_observation" | "official_warning" | "citizen_report" | "simulation";
export type RiskLevel = "low" | "moderate" | "high" | "severe";
export type RiskVerification = "verified" | "unverified" | "simulated";

/** A georeferenced, time-stamped risk observation. Intensity is relative (0–1), not water depth. */
export interface RiskObservation {
  id: string;
  latitude: number;
  longitude: number;
  intensity: number;
  level: RiskLevel;
  timestamp: string;
  source: RiskSource;
  sourceLabel: string;
  verification: RiskVerification;
  confidence?: number;
  area: string;
  summary: string;
  sourceRecordId?: string;
}

export type TimelineEventKind = "risk" | "hazard" | "road" | "incident" | "alert" | "shelter";
export type TimelineEntityKind = "risk" | "hazard" | "road" | "incident" | "alert" | "shelter";

export interface TimelineEvent {
  id: string;
  timestamp: string;
  kind: TimelineEventKind;
  title: string;
  summary: string;
  area: string;
  coordinates: LngLat;
  entityKind: TimelineEntityKind;
  entityId: string;
  source: RiskSource;
}

export const RISK_SOURCE_LABEL: Record<RiskSource, string> = {
  verified_observation: "Verified observation",
  official_warning: "Official warning",
  citizen_report: "Citizen report",
  simulation: "Simulation",
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};

export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  low: "#3fadb0",
  moderate: "#d4a33b",
  high: "#df7139",
  severe: "#c7463c",
};
