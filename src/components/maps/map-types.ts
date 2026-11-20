import type { HazardReport, Incident, LngLat, RescueTeam, RoadSegment, RouteClassification, Shelter } from "@/types";
import type { BasemapId } from "@/config/geo";

export type MapEntityKind = "shelter" | "incident" | "team" | "hazard";
export interface MapSelection {
  kind: MapEntityKind;
  id: string;
}

export type MapLayerKey = "shelters" | "incidents" | "teams" | "hazards" | "roads" | "routes";

export interface MapRoute {
  id: string;
  label: string;
  classification: RouteClassification;
  coordinates: LngLat[];
}

/** Imperative camera request; bump `id` to re-trigger the same target. */
export interface CameraFocus {
  id: number;
  center?: LngLat;
  zoom?: number;
  bounds?: [LngLat, LngLat];
}

export interface SurakshaMapProps {
  shelters?: Shelter[];
  incidents?: Incident[];
  teams?: RescueTeam[];
  hazards?: HazardReport[];
  roads?: RoadSegment[];
  routes?: MapRoute[];
  selectedRouteId?: string | null;
  onSelectRoute?: (id: string) => void;
  origin?: { coordinates: LngLat; label: string } | null;
  selection?: MapSelection | null;
  onSelect?: (sel: MapSelection) => void;
  visible?: Partial<Record<MapLayerKey, boolean>>;
  focus?: CameraFocus | null;
  /** Space taken by overlaid panels, so fits keep content visible. */
  padding?: { top: number; right: number; bottom: number; left: number };
  initialBasemap?: BasemapId;
  /** Fewer camera buttons, for small embedded maps. */
  compact?: boolean;
  className?: string;
  /** Accessible name for the map region. */
  label: string;
}

/** Next camera intent; ids increase so repeated targets still trigger. */
export const nextFocus = (prev: CameraFocus | null, target: Omit<CameraFocus, "id">): CameraFocus => ({ ...target, id: (prev?.id ?? 0) + 1 });

export function boundsOf(coords: LngLat[]): [LngLat, LngLat] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}
