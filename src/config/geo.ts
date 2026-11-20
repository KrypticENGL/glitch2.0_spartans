import type { LngLat } from "@/types";

/** Single source of geographic configuration for the demo (Darbhanga, Bihar). */
export const DEMO_REGION = {
  name: "Darbhanga",
  district: "Darbhanga",
  state: "Bihar",
  center: [85.8995, 26.1475] as LngLat,
  bounds: [
    [85.83, 26.09],
    [85.97, 26.2],
  ] as [LngLat, LngLat],
};

export const DEFAULT_CAMERA = {
  center: DEMO_REGION.center,
  zoom: 13.4,
  pitch: 56,
  bearing: -18,
};

export type BasemapId = "streets" | "light" | "dark";

// OpenFreeMap: free, keyless, documented public instance (https://openfreemap.org). Attribution is in the style.
export const BASEMAPS: Record<BasemapId, { label: string; url: string }> = {
  streets: { label: "Streets", url: "https://tiles.openfreemap.org/styles/liberty" },
  light: { label: "Light", url: "https://tiles.openfreemap.org/styles/positron" },
  dark: { label: "Dark", url: "https://tiles.openfreemap.org/styles/dark" },
};

// AWS Terrain Tiles (Registry of Open Data), Terrarium encoding. Public, keyless.
export const TERRAIN_SOURCE = {
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 14,
  attribution: "Terrain: Mapzen / AWS Terrain Tiles",
  // Real elevation, not exaggerated: the Gangetic plain is almost flat, so relief is subtle by design.
  exaggeration: 1,
};
