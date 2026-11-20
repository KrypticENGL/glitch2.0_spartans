import type { LngLat } from "@/types";
import raw from "./routes.generated.json";

// Typed view of the generated file (JSON imports widen tuples to number[]). Shape is fixed by scripts/generate-routes.mjs.
export interface RawRoute {
  distanceM: number;
  durationS: number;
  coordinates: LngLat[];
}
interface GeneratedGeo {
  source: string;
  generatedAt: string;
  origin: LngLat;
  shelters: Record<string, LngLat>;
  teamBases: Record<string, LngLat>;
  incidents: Record<string, LngLat>;
  shelterRoutes: Record<string, RawRoute[]>;
  missionRoutes: Record<string, RawRoute>;
}

export const geo = raw as unknown as GeneratedGeo;
