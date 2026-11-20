"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Map as MLMap, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BASEMAPS, DEFAULT_CAMERA, TERRAIN_SOURCE, type BasemapId } from "@/config/geo";
import { cn } from "@/lib/utils";
import { CLICKABLE, installLayers, syncLayers } from "./map-layers";
import { MapControls } from "./map-controls";
import type { SurakshaMapProps } from "./map-types";

// Served from public/ (see scripts/copy-maplibre-worker.mjs); v6 can't locate it inside a bundle.
setWorkerUrl("/maplibre-gl-worker.mjs");

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function SurakshaMap(props: SurakshaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [basemapError, setBasemapError] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(props.initialBasemap ?? "streets");
  const [is3D, setIs3D] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [terrainFailed, setTerrainFailed] = useState(false);
  const [buildings, setBuildings] = useState(true);
  const [bearing, setBearing] = useState(DEFAULT_CAMERA.bearing);
  const optsRef = useRef({ buildings, terrain });
  optsRef.current = { buildings, terrain };

  // Create the map exactly once per mount.
  useEffect(() => {
    if (!containerRef.current) return;
    let map: MLMap;
    try {
      map = new MLMap({
        container: containerRef.current,
        style: BASEMAPS[basemap].url,
        center: DEFAULT_CAMERA.center,
        zoom: DEFAULT_CAMERA.zoom,
        pitch: DEFAULT_CAMERA.pitch,
        bearing: DEFAULT_CAMERA.bearing,
        maxPitch: 75,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
    } catch (e) {
      // The map is an external system; its construction failure has to surface as UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFatal(e instanceof Error ? e.message : "WebGL is not available in this browser.");
      return;
    }
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __surakshaMap?: MLMap }).__surakshaMap = map; // dev-only debugging handle

    const onStyleLoad = () => {
      setBasemapError(false);
      installLayers(map, propsRef.current, optsRef.current);
      applyTerrain(map, optsRef.current.terrain);
      setReady(true);
    };
    map.on("style.load", onStyleLoad);
    map.on("rotate", () => setBearing(map.getBearing()));
    map.on("error", (e) => {
      const sourceId = (e as { sourceId?: string }).sourceId;
      if (sourceId === "terrain-dem") {
        setTerrainFailed(true);
        map.setTerrain(null);
      } else if (!map.isStyleLoaded() && !sourceId) {
        setBasemapError(true);
      }
    });
    const canvas = map.getCanvas();
    const onContextLost = () => setFatal("The map's graphics context was lost.");
    canvas.addEventListener("webglcontextlost", onContextLost);

    for (const [layerId, kind] of Object.entries(CLICKABLE)) {
      map.on("click", layerId, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (!id) return;
        const p = propsRef.current;
        if (kind === "route") p.onSelectRoute?.(id);
        else p.onSelect?.({ kind, id });
      });
      map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
    }

    // Container size changes (panels, sidebars) are not window resizes.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      // map.remove() deliberately loses the context; that must not read as a failure (StrictMode remounts).
      canvas.removeEventListener("webglcontextlost", onContextLost);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; later changes go through setStyle/sync effects
  }, []);

  // Push data, selection and visibility into existing sources (no map rebuild).
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map?.isStyleLoaded()) syncLayers(map, props);
  }, [ready, props]);

  // Camera intents.
  const focusId = props.focus?.id;
  useEffect(() => {
    const map = mapRef.current;
    const f = propsRef.current.focus;
    if (!map || !f) return;
    const duration = reducedMotion() ? 0 : 1200;
    const pad = propsRef.current.padding ?? { top: 60, right: 60, bottom: 60, left: 60 };
    if (f.bounds) {
      map.fitBounds(f.bounds, { padding: pad, bearing: map.getBearing(), pitch: map.getPitch(), duration, maxZoom: 16 });
    } else if (f.center) {
      map.flyTo({ center: f.center, zoom: f.zoom ?? Math.max(map.getZoom(), 14.5), duration, padding: pad, essential: true });
    }
  }, [focusId]);

  function applyTerrain(map: MLMap, on: boolean) {
    if (!map.getSource("terrain-dem")) return;
    map.setTerrain(on ? { source: "terrain-dem", exaggeration: TERRAIN_SOURCE.exaggeration } : null);
  }

  const controls = {
    zoomIn: () => mapRef.current?.zoomIn({ duration: reducedMotion() ? 0 : 300 }),
    zoomOut: () => mapRef.current?.zoomOut({ duration: reducedMotion() ? 0 : 300 }),
    rotate: (deg: number) => {
      const map = mapRef.current;
      map?.easeTo({ bearing: map.getBearing() + deg, duration: reducedMotion() ? 0 : 400 });
    },
    resetNorth: () => mapRef.current?.easeTo({ bearing: 0, duration: reducedMotion() ? 0 : 400 }),
    toggle3D: () => {
      const next = !is3D;
      setIs3D(next);
      mapRef.current?.easeTo({ pitch: next ? DEFAULT_CAMERA.pitch : 0, duration: reducedMotion() ? 0 : 600 });
    },
    resetView: () => {
      setIs3D(true);
      mapRef.current?.flyTo({ ...DEFAULT_CAMERA, duration: reducedMotion() ? 0 : 1200, essential: true });
    },
    locate: () => {
      const o = propsRef.current.origin;
      if (o) mapRef.current?.flyTo({ center: o.coordinates, zoom: 15, duration: reducedMotion() ? 0 : 1000, essential: true });
    },
    setBasemap: (id: BasemapId) => {
      if (id === basemap) return;
      setBasemap(id);
      setReady(false);
      mapRef.current?.setStyle(BASEMAPS[id].url); // style.load re-installs our layers
    },
    setTerrain: (on: boolean) => {
      setTerrain(on);
      if (mapRef.current) applyTerrain(mapRef.current, on);
    },
    setBuildings: (on: boolean) => {
      setBuildings(on);
      if (mapRef.current?.getLayer("buildings-3d")) mapRef.current.setLayoutProperty("buildings-3d", "visibility", on ? "visible" : "none");
    },
  };

  if (fatal) {
    return (
      <div role="alert" className={cn("flex h-full w-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center", props.className)}>
        <AlertTriangle className="size-6 text-warn" aria-hidden />
        <p className="max-w-sm text-sm font-medium">The map could not start. {fatal}</p>
        <p className="max-w-sm text-sm text-muted-foreground">Shelter and route details are still listed on this page. Try reloading, or use a browser with WebGL enabled.</p>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-medium">
          <RefreshCw className="size-4" aria-hidden /> Reload map
        </button>
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#dfe6ec]", props.className)}>
      {/* Inline position: maplibre-gl.css is unlayered and would override a Tailwind `absolute` class. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} role="region" aria-label={props.label} />
      {!ready && !basemapError && <div className="pointer-events-none absolute inset-0 animate-pulse bg-[#dfe6ec]/60" aria-hidden />}
      {basemapError && (
        <div role="status" className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-md border border-warn/40 bg-card px-3 py-2 text-sm shadow-sm">
          Basemap tiles could not load (offline or provider unavailable). Data in the side panel is unaffected.
        </div>
      )}
      <MapControls
        bearing={bearing}
        is3D={is3D}
        basemap={basemap}
        terrain={terrain}
        terrainFailed={terrainFailed}
        buildings={buildings}
        canLocate={!!props.origin}
        compact={props.compact}
        {...controls}
      />
    </div>
  );
}
