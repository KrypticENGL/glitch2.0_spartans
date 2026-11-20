/**
 * Transparent, deterministic, rule-based SOS triage. Every point awarded is listed in the breakdown with its reason.
 * Only facts explicitly provided in the request are used: absent fields score zero, nothing is inferred.
 * The result is a SUGGESTION for human operators, who may override it (with a recorded reason).
 */
import { z } from "zod";
import { INCIDENT_TYPES, type IncidentType, type PriorityLevel } from "../../types/enums.js";

export interface PriorityInput {
  emergencyType: IncidentType;
  peopleCount: number;
  lifeThreatening: boolean;
  medicalNeeded: boolean;
  trapped: boolean;
  childrenCount: number;
  elderlyCount: number;
  disabledCount: number;
  /** Verified, unresolved hazards within `hazardRadiusMeters` of the SOS location (looked up via PostGIS). */
  nearbyVerifiedHazards: number;
  /** Minutes since the SOS was created (re-evaluated on demand). */
  waitingMinutes: number;
}

export interface PriorityConfig {
  lifeThreatening: number;
  trapped: number;
  medicalNeeded: number;
  /** points = min(peopleMax, round(peoplePerDoubling * log2(peopleCount))): 1 person 0, 2 → 4, 4 → 8, … */
  peoplePerDoubling: number;
  peopleMax: number;
  children: number;
  elderly: number;
  disabled: number;
  emergencyType: Record<IncidentType, number>;
  hazardRadiusMeters: number;
  perNearbyHazard: number;
  nearbyHazardMax: number;
  waitingMinutesPerPoint: number;
  waitingMax: number;
  thresholds: { critical: number; high: number; medium: number };
}

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  lifeThreatening: 30,
  trapped: 15,
  medicalNeeded: 15,
  peoplePerDoubling: 4,
  peopleMax: 12,
  children: 5,
  elderly: 5,
  disabled: 6,
  emergencyType: { structure_collapse: 12, missing_person: 8, medical: 8, stranded: 6, supplies: 2, other: 0 },
  hazardRadiusMeters: 300,
  perNearbyHazard: 4,
  nearbyHazardMax: 8,
  waitingMinutesPerPoint: 10,
  waitingMax: 10,
  thresholds: { critical: 70, high: 45, medium: 25 },
};

export interface PriorityFactor {
  factor: string;
  points: number;
  reason: string;
}

export interface PriorityResult {
  score: number;
  level: PriorityLevel;
  breakdown: PriorityFactor[];
  configVersion: string;
}

export const PRIORITY_CONFIG_VERSION = "rules-v1";

const nonNeg = z.number().min(0).max(100);
const OverrideSchema = z
  .object({
    lifeThreatening: nonNeg,
    trapped: nonNeg,
    medicalNeeded: nonNeg,
    peoplePerDoubling: nonNeg,
    peopleMax: nonNeg,
    children: nonNeg,
    elderly: nonNeg,
    disabled: nonNeg,
    emergencyType: z.object(Object.fromEntries(INCIDENT_TYPES.map((t) => [t, nonNeg]))).partial(),
    hazardRadiusMeters: z.number().min(0).max(5000),
    perNearbyHazard: nonNeg,
    nearbyHazardMax: nonNeg,
    waitingMinutesPerPoint: z.number().min(1).max(1440),
    waitingMax: nonNeg,
    thresholds: z.object({ critical: nonNeg, high: nonNeg, medium: nonNeg }).partial(),
  })
  .strict()
  .partial();

/** Merges a JSON override (env PRIORITY_CONFIG_JSON) onto the defaults; throws on unknown keys or bad values. */
export function resolvePriorityConfig(json?: string): PriorityConfig {
  if (!json) return DEFAULT_PRIORITY_CONFIG;
  const o = OverrideSchema.parse(JSON.parse(json));
  const d = DEFAULT_PRIORITY_CONFIG;
  const merged: PriorityConfig = {
    ...d,
    ...o,
    emergencyType: { ...d.emergencyType, ...(o.emergencyType as Partial<Record<IncidentType, number>> | undefined) },
    thresholds: { ...d.thresholds, ...o.thresholds },
  };
  const t = merged.thresholds;
  if (!(t.critical > t.high && t.high > t.medium)) throw new Error("priority thresholds must satisfy critical > high > medium");
  return merged;
}

export function levelFor(score: number, t: PriorityConfig["thresholds"]): PriorityLevel {
  if (score >= t.critical) return "critical";
  if (score >= t.high) return "high";
  if (score >= t.medium) return "medium";
  return "low";
}

export function computePriority(input: PriorityInput, config: PriorityConfig = DEFAULT_PRIORITY_CONFIG): PriorityResult {
  const breakdown: PriorityFactor[] = [];
  const add = (factor: string, points: number, reason: string) => {
    if (points > 0) breakdown.push({ factor, points, reason });
  };

  if (input.lifeThreatening) add("life_threatening", config.lifeThreatening, "Reported as life-threatening");
  if (input.trapped) add("trapped", config.trapped, "People reported trapped");
  if (input.medicalNeeded) add("medical", config.medicalNeeded, "Medical assistance requested");

  const people = Math.max(1, Math.floor(input.peopleCount));
  add("people_count", Math.min(config.peopleMax, Math.round(config.peoplePerDoubling * Math.log2(people))), `${people} people affected (log-scaled)`);
  if (input.childrenCount > 0) add("children", config.children, `${input.childrenCount} children reported`);
  if (input.elderlyCount > 0) add("elderly", config.elderly, `${input.elderlyCount} elderly people reported`);
  if (input.disabledCount > 0) add("disabled", config.disabled, `${input.disabledCount} people with disabilities reported`);

  add("emergency_type", config.emergencyType[input.emergencyType], `Emergency type: ${input.emergencyType}`);

  const hazards = Math.max(0, Math.floor(input.nearbyVerifiedHazards));
  add(
    "nearby_hazards",
    Math.min(config.nearbyHazardMax, hazards * config.perNearbyHazard),
    `${hazards} verified hazard(s) within ${config.hazardRadiusMeters} m`,
  );

  const waiting = Math.max(0, Math.floor(input.waitingMinutes));
  add("waiting_time", Math.min(config.waitingMax, Math.floor(waiting / config.waitingMinutesPerPoint)), `Waiting ${waiting} min`);

  const raw = breakdown.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, level: levelFor(score, config.thresholds), breakdown, configVersion: PRIORITY_CONFIG_VERSION };
}
