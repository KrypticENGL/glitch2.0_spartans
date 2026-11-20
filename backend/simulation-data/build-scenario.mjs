// One-off: assembles demo-scenario.json from the frontend's demo geometry (src/data/mock/routes.generated.json)
// so backend and frontend tell the same SIMULATED story. Usage: node simulation-data/build-scenario.mjs
import { readFileSync, writeFileSync } from "node:fs";

const g = JSON.parse(readFileSync(new URL("../../src/data/mock/routes.generated.json", import.meta.url), "utf8"));
const slice = (id, i, f, t) => {
  const c = g.shelterRoutes[id][i].coordinates;
  const a = Math.floor(c.length * f);
  return c.slice(a, Math.max(a + 2, Math.ceil(c.length * t)));
};
const S = g.shelters, T = g.teamBases, I = g.incidents;
const sh = (code, name, kind, area, capacity, occupancy, status, facilities, accessible, accessibilityNotes, contactPhone = null, address = null) =>
  ({ code, name, description: `${kind} (simulated demonstration shelter)`, location: S[code], address, area, capacity, occupancy, status, facilities, accessible, accessibilityNotes, contactPhone });
const team = (code, name, kind, members, capabilities, leadName, leadPhone) =>
  ({ code, name, kind, members, availability: "available", capabilities, location: T[code], leadName, leadPhone });
const inc = (code, area, emergencyType, peopleCount, childrenCount, elderlyCount, disabledCount, medicalNeeded, trapped, lifeThreatening, notes, minutesAgo) =>
  ({ code, location: I[code], area, emergencyType, peopleCount, childrenCount, elderlyCount, disabledCount, medicalNeeded, trapped, lifeThreatening, notes, minutesAgo });

const scenario = {
  provenance: {
    roads: "OpenStreetMap via Overpass API (ODbL); raw extract in osm-darbhanga.json",
    everythingElse: "SIMULATED for demonstration; mirrors the frontend demo scenario (src/data/mock).",
    floodZones: "Synthetic circular zones; NOT hydrological or observed flood data.",
  },
  demoOrigin: { label: "Darbhanga Town (demo citizen location)", location: g.origin },
  floodZones: [
    { name: "Donar low-lying wards", center: [85.884, 26.14], radiusMeters: 900, peakRisk: 80 },
    { name: "Laheriasarai south", center: [85.905, 26.124], radiusMeters: 800, peakRisk: 70 },
    { name: "Shubhankarpur west (Bagmati side)", center: [85.866, 26.15], radiusMeters: 700, peakRisk: 65 },
    { name: "Kadirabad drain", center: [85.912, 26.158], radiusMeters: 450, peakRisk: 45 },
    { name: "Mabbi embankment", center: [85.93, 26.118], radiusMeters: 700, peakRisk: 60 },
  ],
  roadClosures: [
    { name: "Laheriasarai road underpass", status: "blocked", hazardType: "flooding", severity: "severe", note: "Underpass submerged; closed to all traffic.", path: slice("shl-laheriasarai", 0, 0.45, 0.7) },
    { name: "Donar link road", status: "blocked", hazardType: "waterlogging", severity: "severe", note: "Water above 60 cm reported by field team.", path: slice("shl-donar", 0, 0.3, 0.55) },
    { name: "Kadirabad approach", status: "restricted", hazardType: "waterlogging", severity: "moderate", note: "Shallow water (about 30 cm); slow vehicles only.", path: slice("shl-kadirabad", 0, 0.25, 0.5) },
    { name: "Mabbi bypass", status: "blocked", hazardType: "road_damage", severity: "severe", note: "Embankment breach; road surface washed out.", path: slice("shl-mabbi", 1, 0.55, 0.8) },
    { name: "Shubhankarpur lane", status: "unknown", hazardType: "fallen_tree", severity: "moderate", note: "Debris reported; condition not yet confirmed.", path: slice("shl-shubhankarpur", 0, 0.35, 0.6) },
  ],
  unverifiedHazards: [
    { location: [85.8935, 26.1488], hazardType: "fallen_tree", severity: "moderate", description: "Large tree across half the lane (citizen report, demo)." },
    { location: [85.9068, 26.1342], hazardType: "waterlogging", severity: "severe", description: "Knee-deep water outside the market (citizen report, demo)." },
  ],
  shelters: [
    sh("shl-laheriasarai", "Laheriasarai Relief Camp", "School building", "Laheriasarai", 650, 412, "open", ["water", "medical", "food", "power", "accessible", "sanitation"], true, "Ground-floor halls, ramp at main gate, accessible toilets.", "+91 00000 10001", "Near Laheriasarai Chowk (approx.)"),
    sh("shl-donar", "Donar Community Hall", "Community hall", "Donar", 280, 261, "near_capacity", ["water", "food", "sanitation"], false, "Three steps at entrance; portable ramp on request.", "+91 00000 10002"),
    sh("shl-kadirabad", "Kadirabad High-Ground Shelter", "College campus", "Kadirabad", 900, 388, "open", ["water", "medical", "food", "power", "accessible", "sanitation"], true, "Level access across campus.", "+91 00000 10003"),
    sh("shl-allalpatti", "Allalpatti Panchayat Bhawan", "Panchayat building", "Allalpatti", 220, 220, "full", ["water", "food"], false, "First-floor hall only; no lift."),
    sh("shl-benta", "Benta Stadium Camp", "Stadium", "Benta", 1200, 540, "open", ["water", "medical", "food", "power", "sanitation"], false, "Tent blocks; gravel paths difficult for wheelchairs.", "+91 00000 10005"),
    sh("shl-shubhankarpur", "Shubhankarpur Middle School", "School building", "Shubhankarpur", 340, 190, "open", ["water", "food", "accessible", "sanitation"], true, "Ramp at side entrance."),
    sh("shl-mabbi", "Mabbi Relief Point", "Warehouse (temporary)", "Mabbi", 450, 0, "closed", ["water", "power"], false, "Not yet staffed."),
    sh("shl-bahadurpur", "Bahadurpur Primary Health Annexe", "Health annexe", "Bahadurpur", 160, 118, "open", ["water", "medical", "food", "power", "accessible"], true, "Priority for elderly, pregnant women and people with disabilities.", "+91 00000 10008"),
  ],
  teams: [
    team("team-ndrf-1", "NDRF Alpha", "NDRF", 12, ["boat", "swiftwater", "first_aid"], "Insp. R. Kumar (demo)", "+91 00000 20001"),
    team("team-sdrf-2", "SDRF Bravo", "SDRF", 10, ["cutting_tools", "stretcher", "first_aid"], "SI A. Jha (demo)", "+91 00000 20002"),
    team("team-boat-3", "Boat Unit 3", "Boat", 6, ["boat"], "M. Sahni (demo)", "+91 00000 20003"),
    team("team-med-4", "Medical Response 4", "Medical", 5, ["ambulance", "medical", "oxygen"], "Dr. P. Mishra (demo)", "+91 00000 20004"),
    team("team-civ-5", "Civil Defence Echo", "Civil Defence", 15, ["evacuation", "relief_supplies"], "S. Yadav (demo)", "+91 00000 20005"),
  ],
  incidents: [
    inc("INC-1041", "Donar", "stranded", 14, 4, 2, 0, false, true, true, "Family group on rooftop, water at first-floor level.", 95),
    inc("INC-1042", "Laheriasarai South", "medical", 2, 0, 1, 0, true, false, true, "Elderly man with breathing difficulty; road access cut.", 67),
    inc("INC-1043", "Shubhankarpur", "stranded", 9, 3, 0, 0, false, false, false, "Residents asking for evacuation.", 45),
    inc("INC-1044", "Bahadurpur", "supplies", 40, 0, 0, 0, false, false, false, "Drinking water running out in lane.", 29),
    inc("INC-1045", "Allalpatti", "structure_collapse", 5, 1, 1, 0, true, true, false, "Boundary wall collapsed onto kutcha house.", 112),
    inc("INC-1046", "Kadirabad", "missing_person", 1, 1, 0, 0, false, false, false, "Teenager missing since evening near drain.", 16),
    inc("INC-1047", "Shubhankarpur West", "stranded", 6, 0, 1, 1, false, false, false, "Family and livestock on embankment.", 3),
    inc("INC-1049", "Darbhanga Town", "medical", 1, 0, 0, 0, true, false, false, "Pregnant woman needs transfer to hospital.", 42),
  ],
  missions: [
    { code: "MSN-301", incident: "INC-1041", team: "team-ndrf-1", status: "en_route" },
    { code: "MSN-302", incident: "INC-1042", team: "team-boat-3", status: "assigned" },
    { code: "MSN-303", incident: "INC-1045", team: "team-sdrf-2", status: "on_site" },
    { code: "MSN-304", incident: "INC-1049", team: "team-med-4", status: "accepted" },
  ],
};
writeFileSync(new URL("./demo-scenario.json", import.meta.url), JSON.stringify(scenario, null, 1));
console.log("demo-scenario.json written");
