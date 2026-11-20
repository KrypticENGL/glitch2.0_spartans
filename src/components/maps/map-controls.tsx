"use client";

import { Box, Compass, Crosshair, Layers, Minus, Plus, RotateCcw, RotateCw, Square, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { BASEMAPS, type BasemapId } from "@/config/geo";
import { cn } from "@/lib/utils";

interface Props {
  bearing: number;
  is3D: boolean;
  basemap: BasemapId;
  terrain: boolean;
  terrainFailed: boolean;
  buildings: boolean;
  canLocate: boolean;
  compact?: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  rotate: (deg: number) => void;
  resetNorth: () => void;
  toggle3D: () => void;
  resetView: () => void;
  locate: () => void;
  setBasemap: (id: BasemapId) => void;
  setTerrain: (on: boolean) => void;
  setBuildings: (on: boolean) => void;
}

function Ctl({ label, onClick, children, pressed, className }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn("grid size-10 place-items-center text-foreground transition-colors hover:bg-muted focus-visible:relative focus-visible:z-10 sm:size-9", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

const group = "flex flex-col divide-y overflow-hidden rounded-md border bg-card shadow-[0_1px_3px_rgb(14_34_53/0.12)]";

export function MapControls(p: Props) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
      {!p.compact && (
        <div className={cn(group, "pointer-events-auto")} role="group" aria-label="Zoom">
          <Ctl label="Zoom in" onClick={p.zoomIn}><Plus className="size-4" /></Ctl>
          <Ctl label="Zoom out" onClick={p.zoomOut}><Minus className="size-4" /></Ctl>
        </div>
      )}
      <div className={cn(group, "pointer-events-auto")} role="group" aria-label="Orientation">
        <Ctl label={`Reset to north (bearing ${Math.round(p.bearing)}°)`} onClick={p.resetNorth}>
          <Compass className="size-4" style={{ transform: `rotate(${-p.bearing - 45}deg)` }} />
        </Ctl>
        {!p.compact && <Ctl label="Rotate left" className="max-sm:hidden" onClick={() => p.rotate(-30)}><RotateCcw className="size-4" /></Ctl>}
        {!p.compact && <Ctl label="Rotate right" className="max-sm:hidden" onClick={() => p.rotate(30)}><RotateCw className="size-4" /></Ctl>}
        <Ctl label={p.is3D ? "Switch to flat 2D view" : "Switch to tilted 3D view"} onClick={p.toggle3D} pressed={p.is3D}>
          {p.is3D ? <Box className="size-4" /> : <Square className="size-4" />}
          <span className="sr-only">{p.is3D ? "3D on" : "2D on"}</span>
        </Ctl>
        <Ctl label="Reset camera to default view" onClick={p.resetView}><Undo2 className="size-4" /></Ctl>
        {p.canLocate && <Ctl label="Go to my location (demo)" onClick={p.locate}><Crosshair className="size-4" /></Ctl>}
      </div>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Map style and 3D options" className={cn(group, "pointer-events-auto grid size-10 place-items-center hover:bg-muted sm:size-9")}>
                <Layers className="size-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Map style and 3D options</TooltipContent>
        </Tooltip>
        <PopoverContent side="left" align="start" className="w-64 space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Basemap</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={p.basemap === id}
                  onClick={() => p.setBasemap(id)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs font-medium",
                    p.basemap === id ? "border-teal bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  {BASEMAPS[id].label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="opt-buildings" className="text-sm font-normal">3D buildings</Label>
            <Switch id="opt-buildings" checked={p.buildings} onCheckedChange={p.setBuildings} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="opt-terrain" className="text-sm font-normal">Terrain elevation</Label>
              <Switch id="opt-terrain" checked={p.terrain && !p.terrainFailed} disabled={p.terrainFailed} onCheckedChange={p.setTerrain} />
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              {p.terrainFailed ? "Elevation tiles are unavailable right now." : "Real elevation, not exaggerated. The Mithila plain is nearly flat, so relief is subtle."}
            </p>
          </div>
          <p className="border-t pt-3 text-xs leading-snug text-muted-foreground">
            Building heights come from OpenStreetMap (via OpenMapTiles, which may derive them from floor counts). Buildings with no height data are drawn flat. Drag with right mouse or Ctrl to tilt and rotate; two-finger drag on touch screens.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
