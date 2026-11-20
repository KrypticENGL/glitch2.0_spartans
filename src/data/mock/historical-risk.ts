import type { RiskLevel, RiskObservation, RiskSource, RiskVerification } from "@/types";
import { DEMO_ORIGIN, SEED_ALERTS, SEED_HAZARDS, SEED_SHELTERS } from "./seed";
import { ROAD_SEGMENTS } from "./road-segments";

const level = (intensity: number): RiskLevel => intensity >= 0.82 ? "severe" : intensity >= 0.62 ? "high" : intensity >= 0.36 ? "moderate" : "low";
const fromCoordinates = (
  id: string,
  coordinates: [number, number],
  intensity: number,
  timestamp: string,
  source: RiskSource,
  sourceLabel: string,
  verification: RiskVerification,
  area: string,
  summary: string,
  sourceRecordId?: string,
  confidence?: number,
): RiskObservation => ({
  id,
  longitude: coordinates[0],
  latitude: coordinates[1],
  intensity,
  level: level(intensity),
  timestamp,
  source,
  sourceLabel,
  verification,
  area,
  summary,
  sourceRecordId,
  confidence,
});

const shelterAt = (area: string) => SEED_SHELTERS.find((s) => area.toLowerCase().includes(s.location.area.toLowerCase()));
const alertCoordinates = (area: string) => shelterAt(area)?.location.coordinates ?? DEMO_ORIGIN.coordinates;
const middleOf = (coordinates: [number, number][]) => coordinates[Math.floor(coordinates.length / 2)] ?? DEMO_ORIGIN.coordinates;

/**
 * Illustrative relative-risk samples for the fixed 14 Aug 2026 scenario.
 * Values are not water depth or a mapped inundation boundary. Simulation samples
 * are anchored to existing demo locations; source observations retain their record IDs.
 */
export const HISTORICAL_RISK: RiskObservation[] = [
  fromCoordinates("risk-sim-0800", DEMO_ORIGIN.coordinates, 0.2, "2026-08-14T02:30:00Z", "simulation", "Demonstration model", "simulated", DEMO_ORIGIN.area, "Initial low relative-risk sample for the demonstration.", undefined, 0.45),
  fromCoordinates("risk-sim-0900-donar", SEED_SHELTERS.find((s) => s.id === "shl-donar")!.location.coordinates, 0.31, "2026-08-14T03:30:00Z", "simulation", "Demonstration model", "simulated", "Donar", "Additional modeled sample added to the timeline.", undefined, 0.48),
  fromCoordinates("risk-verified-seg2", middleOf(ROAD_SEGMENTS.find((r) => r.id === "seg-2")!.coordinates), 0.61, ROAD_SEGMENTS.find((r) => r.id === "seg-2")!.reportedAt!, "verified_observation", "Field team road observation", "verified", "Donar", "Field team reported water above 60 cm on Donar link road.", "seg-2", 0.88),
  fromCoordinates("risk-sim-1000-laheria", SEED_SHELTERS.find((s) => s.id === "shl-laheriasarai")!.location.coordinates, 0.48, "2026-08-14T04:30:00Z", "simulation", "Demonstration model", "simulated", "Laheriasarai", "Modeled risk increased in the selected demonstration area.", undefined, 0.5),
  ...SEED_ALERTS.slice(0, 2).map((alert) => {
    const at = alert.issuedAt;
    const intensity = alert.severity === "severe" ? 0.74 : 0.55;
    return fromCoordinates(`risk-${alert.id.toLowerCase()}`, alertCoordinates(alert.area), intensity, at, "official_warning", "District warning (simulated)", "simulated", alert.area, alert.title, alert.id, 0.78);
  }),
  ...SEED_HAZARDS.map((hazard) => fromCoordinates(
    `risk-${hazard.id.toLowerCase()}`,
    hazard.location.coordinates,
    hazard.severity === "severe" ? 0.92 : 0.68,
    hazard.reportedAt,
    "citizen_report",
    "Citizen hazard report",
    hazard.review === "verified" ? "verified" : "unverified",
    hazard.location.area,
    hazard.description,
    hazard.id,
    hazard.review === "verified" ? 0.86 : 0.58,
  )),
  fromCoordinates("risk-sim-1200-mabbi", SEED_SHELTERS.find((s) => s.id === "shl-mabbi")!.location.coordinates, 0.7, "2026-08-14T06:30:00Z", "simulation", "Demonstration model", "simulated", "Mabbi", "Later modeled sample for the illustrative timeline.", undefined, 0.52),
].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
