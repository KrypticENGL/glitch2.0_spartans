// Demonstration dataset. Every shelter, incident, team and alert below is FICTIONAL.
// Locality names are real neighbourhoods of Darbhanga; positions are approximate and snapped to OSM roads.
import type {
  EmergencyAlert,
  HazardReport,
  Incident,
  LngLat,
  RescueMission,
  RescueTeam,
  Shelter,
} from "@/types";
import { geo, type RawRoute } from "./geo";

const pt = (c: LngLat) => c;
const D = "Darbhanga";

export const DEMO_ORIGIN = {
  label: "Your location (demo)",
  area: "Darbhanga Town",
  coordinates: pt(geo.origin),
};

export const SEED_SHELTERS: Shelter[] = [
  {
    id: "shl-laheriasarai",
    name: "Laheriasarai Relief Camp",
    kind: "School building",
    location: { coordinates: pt(geo.shelters["shl-laheriasarai"]), area: "Laheriasarai", district: D, address: "Near Laheriasarai Chowk (approx.)" },
    capacity: 650,
    occupancy: 412,
    facilities: ["water", "medical", "food", "power", "accessible", "sanitation"],
    accessibilityNotes: "Ground-floor halls, ramp at main gate, accessible toilets.",
    status: "open",
    contact: { name: "Camp desk (demo)", phone: "+91 00000 10001" },
    simulated: true,
  },
  {
    id: "shl-donar",
    name: "Donar Community Hall",
    kind: "Community hall",
    location: { coordinates: pt(geo.shelters["shl-donar"]), area: "Donar", district: D },
    capacity: 280,
    occupancy: 261,
    facilities: ["water", "food", "sanitation"],
    accessibilityNotes: "Three steps at entrance; portable ramp available on request.",
    status: "near_capacity",
    contact: { name: "Hall warden (demo)", phone: "+91 00000 10002" },
    simulated: true,
  },
  {
    id: "shl-kadirabad",
    name: "Kadirabad High-Ground Shelter",
    kind: "College campus",
    location: { coordinates: pt(geo.shelters["shl-kadirabad"]), area: "Kadirabad", district: D },
    capacity: 900,
    occupancy: 388,
    facilities: ["water", "medical", "food", "power", "accessible", "sanitation"],
    accessibilityNotes: "Level access across campus; wheelchair available at medical post.",
    status: "open",
    contact: { name: "Campus control room (demo)", phone: "+91 00000 10003" },
    simulated: true,
  },
  {
    id: "shl-allalpatti",
    name: "Allalpatti Panchayat Bhawan",
    kind: "Panchayat building",
    location: { coordinates: pt(geo.shelters["shl-allalpatti"]), area: "Allalpatti", district: D },
    capacity: 220,
    occupancy: 220,
    facilities: ["water", "food"],
    accessibilityNotes: "First-floor hall only; no lift.",
    status: "full",
    simulated: true,
  },
  {
    id: "shl-benta",
    name: "Benta Stadium Camp",
    kind: "Stadium",
    location: { coordinates: pt(geo.shelters["shl-benta"]), area: "Benta", district: D },
    capacity: 1200,
    occupancy: 540,
    facilities: ["water", "medical", "food", "power", "sanitation"],
    accessibilityNotes: "Tent blocks on level ground; gravel paths may be difficult for wheelchairs.",
    status: "open",
    contact: { name: "Stadium camp desk (demo)", phone: "+91 00000 10005" },
    simulated: true,
  },
  {
    id: "shl-shubhankarpur",
    name: "Shubhankarpur Middle School",
    kind: "School building",
    location: { coordinates: pt(geo.shelters["shl-shubhankarpur"]), area: "Shubhankarpur", district: D },
    capacity: 340,
    occupancy: 190,
    facilities: ["water", "food", "accessible", "sanitation"],
    accessibilityNotes: "Ramp at side entrance; accessible toilet block.",
    status: "open",
    simulated: true,
  },
  {
    id: "shl-mabbi",
    name: "Mabbi Relief Point",
    kind: "Warehouse (temporary)",
    location: { coordinates: pt(geo.shelters["shl-mabbi"]), area: "Mabbi", district: D },
    capacity: 450,
    occupancy: 0,
    facilities: ["water", "power"],
    accessibilityNotes: "Not yet staffed.",
    status: "closed",
    simulated: true,
  },
  {
    id: "shl-bahadurpur",
    name: "Bahadurpur Primary Health Annexe",
    kind: "Health annexe",
    location: { coordinates: pt(geo.shelters["shl-bahadurpur"]), area: "Bahadurpur", district: D },
    capacity: 160,
    occupancy: 118,
    facilities: ["water", "medical", "food", "power", "accessible"],
    accessibilityNotes: "Priority for elderly, pregnant women and people with disabilities.",
    status: "open",
    contact: { name: "Duty nurse (demo)", phone: "+91 00000 10008" },
    simulated: true,
  },
];

const inc = (id: string, area: string, rest: Omit<Incident, "id" | "location" | "source">): Incident => ({
  id,
  location: { coordinates: pt(geo.incidents[id]), area, district: D },
  source: "seed",
  ...rest,
});

export const SEED_INCIDENTS: Incident[] = [
  inc("INC-1041", "Donar", { type: "stranded", priority: "critical", status: "en_route", reportedAt: "2026-08-14T05:12:00Z", peopleAffected: 14, medicalNeeded: false, notes: "Family group on rooftop, water at first-floor level.", assignedTeamId: "team-ndrf-1" }),
  inc("INC-1042", "Laheriasarai South", { type: "medical", priority: "critical", status: "assigned", reportedAt: "2026-08-14T05:40:00Z", peopleAffected: 2, medicalNeeded: true, notes: "Elderly man with breathing difficulty; road access cut.", assignedTeamId: "team-boat-3" }),
  inc("INC-1043", "Shubhankarpur", { type: "stranded", priority: "high", status: "new", reportedAt: "2026-08-14T06:02:00Z", peopleAffected: 9, medicalNeeded: false, notes: "Residents asking for evacuation, includes 3 children." }),
  inc("INC-1044", "Bahadurpur", { type: "supplies", priority: "medium", status: "new", reportedAt: "2026-08-14T06:18:00Z", peopleAffected: 40, medicalNeeded: false, notes: "Drinking water running out in lane." }),
  inc("INC-1045", "Allalpatti", { type: "structure_collapse", priority: "high", status: "on_site", reportedAt: "2026-08-14T04:55:00Z", peopleAffected: 5, medicalNeeded: true, notes: "Boundary wall collapsed onto kutcha house.", assignedTeamId: "team-sdrf-2" }),
  inc("INC-1046", "Kadirabad", { type: "missing_person", priority: "high", status: "new", reportedAt: "2026-08-14T06:31:00Z", peopleAffected: 1, medicalNeeded: false, notes: "Teenager missing since evening near drain." }),
  inc("INC-1047", "Shubhankarpur West", { type: "stranded", priority: "medium", status: "new", reportedAt: "2026-08-14T06:44:00Z", peopleAffected: 6, medicalNeeded: false, notes: "Livestock and family on embankment." }),
  inc("INC-1048", "Mabbi", { type: "stranded", priority: "high", status: "resolved", reportedAt: "2026-08-14T03:20:00Z", peopleAffected: 11, medicalNeeded: false, notes: "Evacuated to Laheriasarai camp.", assignedTeamId: "team-boat-3" }),
  inc("INC-1049", "Darbhanga Town", { type: "medical", priority: "medium", status: "assigned", reportedAt: "2026-08-14T06:05:00Z", peopleAffected: 1, medicalNeeded: true, notes: "Pregnant woman needs transfer to hospital.", assignedTeamId: "team-med-4" }),
  inc("INC-1050", "Kadirabad North", { type: "other", priority: "low", status: "new", reportedAt: "2026-08-14T06:50:00Z", peopleAffected: 3, medicalNeeded: false, notes: "Snake sighting in relief tent area." }),
];

const team = (id: string, area: string, rest: Omit<RescueTeam, "id" | "base">): RescueTeam => ({
  id,
  base: { coordinates: pt(geo.teamBases[id]), area, district: D },
  ...rest,
});

export const SEED_TEAMS: RescueTeam[] = [
  team("team-ndrf-1", "Laheriasarai", { name: "NDRF Alpha", kind: "NDRF", members: 12, availability: "on_mission", lead: { name: "Insp. R. Kumar (demo)", phone: "+91 00000 20001" }, equipment: ["Inflatable boat", "Life jackets", "Rope kit"] }),
  team("team-sdrf-2", "Donar", { name: "SDRF Bravo", kind: "SDRF", members: 10, availability: "on_mission", lead: { name: "SI A. Jha (demo)", phone: "+91 00000 20002" }, equipment: ["Cutting tools", "Stretchers"] }),
  team("team-boat-3", "Bahadurpur", { name: "Boat Unit 3", kind: "Boat", members: 6, availability: "on_mission", lead: { name: "M. Sahni (demo)", phone: "+91 00000 20003" }, equipment: ["Motor boat", "Life buoys"] }),
  team("team-med-4", "Darbhanga Town", { name: "Medical Response 4", kind: "Medical", members: 5, availability: "on_mission", lead: { name: "Dr. P. Mishra (demo)", phone: "+91 00000 20004" }, equipment: ["Ambulance", "Oxygen", "First-aid"] }),
  team("team-civ-5", "Allalpatti", { name: "Civil Defence Echo", kind: "Civil Defence", members: 15, availability: "available", lead: { name: "S. Yadav (demo)", phone: "+91 00000 20005" }, equipment: ["Megaphones", "Relief kits"] }),
];

export const SEED_MISSIONS: RescueMission[] = [
  { id: "MSN-301", incidentId: "INC-1041", teamId: "team-ndrf-1", status: "en_route", createdAt: "2026-08-14T05:15:00Z", updatedAt: "2026-08-14T05:30:00Z" },
  { id: "MSN-302", incidentId: "INC-1042", teamId: "team-boat-3", status: "assigned", createdAt: "2026-08-14T05:45:00Z", updatedAt: "2026-08-14T05:45:00Z" },
  { id: "MSN-303", incidentId: "INC-1045", teamId: "team-sdrf-2", status: "on_site", createdAt: "2026-08-14T05:00:00Z", updatedAt: "2026-08-14T05:50:00Z" },
  { id: "MSN-304", incidentId: "INC-1049", teamId: "team-med-4", status: "assigned", createdAt: "2026-08-14T06:08:00Z", updatedAt: "2026-08-14T06:08:00Z" },
  { id: "MSN-299", incidentId: "INC-1048", teamId: "team-boat-3", status: "completed", createdAt: "2026-08-14T03:25:00Z", updatedAt: "2026-08-14T04:40:00Z" },
];

/** Pre-computed road-following legs for seeded missions, keyed `${teamId}:${incidentId}`. */
export const MISSION_ROUTES: Record<string, RawRoute> = geo.missionRoutes;

export const SEED_ALERTS: EmergencyAlert[] = [
  { id: "ALT-1", severity: "severe", title: "Rising water near Donar and Laheriasarai", body: "Low-lying lanes are waterlogged. Move to higher floors or the nearest open shelter. Avoid the underpass on the Laheriasarai road.", area: "Donar, Laheriasarai", issuedAt: "2026-08-14T05:00:00Z" },
  { id: "ALT-2", severity: "warning", title: "Shallow water on Kadirabad approach", body: "Vehicles can pass slowly. Pedestrians should keep to the raised side of the road.", area: "Kadirabad", issuedAt: "2026-08-14T05:35:00Z" },
  { id: "ALT-3", severity: "advisory", title: "Drinking water distribution", body: "Packaged water is available at Benta Stadium Camp and Kadirabad High-Ground Shelter until 18:00.", area: "Darbhanga Town", issuedAt: "2026-08-14T06:10:00Z" },
];

export const SEED_HAZARDS: HazardReport[] = [
  { id: "HZ-11", type: "fallen_tree", severity: "moderate", description: "Large tree across half the lane.", location: { coordinates: [85.8935, 26.1488], area: "Darbhanga Town", district: D }, reportedAt: "2026-08-14T05:58:00Z", review: "unverified" },
  { id: "HZ-12", type: "waterlogging", severity: "severe", description: "Knee-deep water outside the market.", location: { coordinates: [85.9068, 26.1342], area: "Laheriasarai", district: D }, reportedAt: "2026-08-14T06:12:00Z", review: "verified" },
];

/** Locality picker options for citizen forms (approximate centroids on the road network). */
export const LOCALITIES: { area: string; coordinates: LngLat }[] = [
  { area: DEMO_ORIGIN.area, coordinates: DEMO_ORIGIN.coordinates },
  ...SEED_SHELTERS.map((s) => ({ area: s.location.area, coordinates: s.location.coordinates })),
].sort((a, b) => a.area.localeCompare(b.area));
