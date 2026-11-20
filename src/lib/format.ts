import type {
  AlertSeverity,
  HazardType,
  IncidentStatus,
  IncidentType,
  MissionStatus,
  Priority,
  RoadCondition,
  RouteClassification,
  Shelter,
  ShelterFacility,
  ShelterStatus,
} from "@/types";

// All user-facing strings for enum values live here so a Hindi dictionary can replace them later.
export const L = {
  shelterStatus: { open: "Open", near_capacity: "Nearly full", full: "Full", closed: "Closed" } satisfies Record<ShelterStatus, string>,
  facility: { water: "Drinking water", medical: "Medical aid", food: "Food", power: "Electricity", accessible: "Accessible", sanitation: "Toilets" } satisfies Record<ShelterFacility, string>,
  route: { recommended: "Recommended", alternative: "Alternative", caution: "Caution", unavailable: "Unavailable" } satisfies Record<RouteClassification, string>,
  road: { open: "Open", caution: "Caution", flooded: "Flooded", blocked: "Blocked" } satisfies Record<RoadCondition, string>,
  incidentType: { stranded: "Stranded people", medical: "Medical emergency", structure_collapse: "Structure collapse", missing_person: "Missing person", supplies: "Supplies needed", other: "Other" } satisfies Record<IncidentType, string>,
  priority: { critical: "Critical", high: "High", medium: "Medium", low: "Low" } satisfies Record<Priority, string>,
  incidentStatus: { new: "New", assigned: "Assigned", en_route: "En route", on_site: "On site", resolved: "Resolved" } satisfies Record<IncidentStatus, string>,
  missionStatus: { assigned: "Assigned", accepted: "Accepted", en_route: "En route", on_site: "On site", completed: "Completed" } satisfies Record<MissionStatus, string>,
  alert: { severe: "Severe", warning: "Warning", advisory: "Advisory" } satisfies Record<AlertSeverity, string>,
  hazard: { waterlogging: "Waterlogging", road_damage: "Road damage", fallen_tree: "Fallen tree", bridge_issue: "Bridge / culvert issue", power_line: "Fallen power line", other: "Other" } satisfies Record<HazardType, string>,
};

export const formatKm = (m?: number) => (m == null ? "—" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
export const formatMin = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
export const formatTime = (iso: string) => `${timeFmt.format(new Date(iso))} IST`;
export const formatDateTime = (iso: string) => `${dateTimeFmt.format(new Date(iso))} IST`;

export const occupancyPct = (s: Pick<Shelter, "occupancy" | "capacity">) => (s.capacity ? Math.round((s.occupancy / s.capacity) * 100) : 0);
export const spacesLeft = (s: Pick<Shelter, "occupancy" | "capacity">) => Math.max(0, s.capacity - s.occupancy);

/** Tone tokens map onto the CSS status variables (see globals.css). */
export type Tone = "ok" | "warn" | "danger" | "info" | "muted";
export const tone = {
  shelter: { open: "ok", near_capacity: "warn", full: "danger", closed: "muted" } satisfies Record<ShelterStatus, Tone>,
  route: { recommended: "ok", alternative: "info", caution: "warn", unavailable: "danger" } satisfies Record<RouteClassification, Tone>,
  road: { open: "ok", caution: "warn", flooded: "danger", blocked: "danger" } satisfies Record<RoadCondition, Tone>,
  priority: { critical: "danger", high: "warn", medium: "info", low: "muted" } satisfies Record<Priority, Tone>,
  incident: { new: "danger", assigned: "warn", en_route: "info", on_site: "info", resolved: "ok" } satisfies Record<IncidentStatus, Tone>,
  mission: { assigned: "warn", accepted: "info", en_route: "info", on_site: "info", completed: "ok" } satisfies Record<MissionStatus, Tone>,
  alert: { severe: "danger", warning: "warn", advisory: "info" } satisfies Record<AlertSeverity, Tone>,
};

/** Hex values for map paint (WebGL can't read CSS variables). Keep in sync with globals.css. */
export const TONE_HEX: Record<Tone, string> = { ok: "#2F8F4E", warn: "#C27C0E", danger: "#C8322B", info: "#0F8B8D", muted: "#6B7785" };
