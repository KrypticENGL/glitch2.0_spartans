import type { LngLat, RoadSegment } from "@/types";
import { geo } from "./geo";

type RouteRef = { shelterId: string; index: number; from: number; to: number };

// Road conditions are SIMULATED. Each segment is a slice of a real OSM-aligned route so it sits on an actual road.
function sliceOf({ shelterId, index, from, to }: RouteRef): LngLat[] {
  const coords = geo.shelterRoutes[shelterId][index].coordinates;
  const a = Math.floor(coords.length * from);
  const b = Math.max(a + 2, Math.ceil(coords.length * to));
  return coords.slice(a, b);
}

export const ROAD_SEGMENTS: RoadSegment[] = [
  { id: "seg-1", name: "Laheriasarai road underpass", condition: "blocked", note: "Underpass submerged; closed to all traffic.", coordinates: sliceOf({ shelterId: "shl-laheriasarai", index: 0, from: 0.45, to: 0.7 }), verified: true },
  { id: "seg-2", name: "Donar link road", condition: "flooded", note: "Water above 60 cm reported by field team.", coordinates: sliceOf({ shelterId: "shl-donar", index: 0, from: 0.3, to: 0.55 }), verified: true },
  { id: "seg-3", name: "Kadirabad approach", condition: "caution", note: "Shallow water (about 30 cm); slow vehicles only.", coordinates: sliceOf({ shelterId: "shl-kadirabad", index: 0, from: 0.25, to: 0.5 }), verified: true },
  { id: "seg-4", name: "Mabbi bypass", condition: "blocked", note: "Embankment breach; road surface washed out.", coordinates: sliceOf({ shelterId: "shl-mabbi", index: 1, from: 0.55, to: 0.8 }), verified: true },
  { id: "seg-5", name: "Shubhankarpur lane", condition: "caution", note: "Debris on carriageway; single lane passable.", coordinates: sliceOf({ shelterId: "shl-shubhankarpur", index: 0, from: 0.35, to: 0.6 }), verified: false },
];
