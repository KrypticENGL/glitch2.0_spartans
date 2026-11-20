"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { MapView } from "@/components/maps/map-view";
import { MapPanel, sheetPx, type SheetSize } from "@/components/maps/map-panel";
import { boundsOf, nextFocus, type CameraFocus, type MapSelection } from "@/components/maps/map-types";
import { ShelterCard } from "./shelter-parts";
import { ShelterDetail } from "./shelter-detail";
import { DemoBadge } from "@/components/shared/status";
import { Input } from "@/components/ui/input";
import { useDemoStore } from "@/store/demo-store";
import { getRoutesToShelter } from "@/features/routing/adapter";
import { SHELTER_DISTANCE, SHELTER_FILTERS, filterShelters, type ShelterFilter } from "@/features/shelters/selectors";
import { DEMO_ORIGIN } from "@/data/mock/seed";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function ShelterLocator() {
  const shelters = useDemoStore((s) => s.shelters);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShelterFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const [sheet, setSheet] = useState<SheetSize>("half");
  const isMobile = useIsMobile();

  const visible = useMemo(() => filterShelters(shelters, query, filter), [shelters, query, filter]);
  const selected = shelters.find((s) => s.id === selectedId) ?? null;
  const routes = useMemo(() => (selectedId ? getRoutesToShelter(selectedId) : []), [selectedId]);

  const padding = isMobile ? { top: 60, right: 60, bottom: sheetPx(sheet) + 20, left: 30 } : { top: 60, right: 70, bottom: 60, left: 440 };

  function select(id: string, from: "list" | "map") {
    setSelectedId(id);
    const r = getRoutesToShelter(id);
    setRouteId(r[0]?.id ?? null);
    if (isMobile && sheet === "peek") setSheet("half");
    const sh = shelters.find((s) => s.id === id);
    // From the list we move the camera to the shelter; from the map the user already sees it.
    if (sh && from === "list") setFocus((f) => nextFocus(f, { center: sh.location.coordinates }));
  }

  function selectRoute(id: string) {
    setRouteId(id);
    const r = routes.find((x) => x.id === id);
    if (r) setFocus((f) => nextFocus(f, { bounds: boundsOf(r.coordinates) }));
  }

  function onMapSelect(sel: MapSelection) {
    if (sel.kind === "shelter") select(sel.id, "map");
  }

  const header = selected ? null : (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Nearby shelters</h1>
        <DemoBadge label="Simulated" />
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by shelter or area"
          aria-label="Search shelters by name or area"
          className="h-10 bg-card pr-9 pl-9"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-sm hover:bg-muted">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div role="radiogroup" aria-label="Filter shelters" className="flex gap-1.5 overflow-x-auto">
        {SHELTER_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3 text-sm font-medium",
              filter === f.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-3.5rem-4rem)] md:h-[calc(100dvh-3.5rem)]">
      <MapView
        label="3D map of shelters around Darbhanga"
        shelters={visible}
        roads={ROAD_SEGMENTS}
        routes={routes}
        selectedRouteId={routeId}
        onSelectRoute={selectRoute}
        origin={DEMO_ORIGIN}
        selection={selectedId ? { kind: "shelter", id: selectedId } : null}
        onSelect={onMapSelect}
        focus={focus}
        padding={padding}
      />
      <MapPanel title={selected ? `${selected.name} details` : "Shelter list"} header={header} size={sheet} onSizeChange={setSheet}>
        {selected ? (
          <ShelterDetail
            shelter={selected}
            distanceM={SHELTER_DISTANCE[selected.id]}
            routes={routes}
            selectedRouteId={routeId}
            onSelectRoute={selectRoute}
            onBack={() => {
              setSelectedId(null);
              setRouteId(null);
            }}
          />
        ) : (
          <div className="space-y-2.5">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {visible.length} of {shelters.length} shelters · sorted by road distance from your demo location
            </p>
            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm">
                <p className="font-medium">No shelters match.</p>
                <button type="button" className="mt-2 font-semibold text-teal underline-offset-4 hover:underline" onClick={() => { setQuery(""); setFilter("all"); }}>
                  Clear search and filters
                </button>
              </div>
            ) : (
              visible.map((s) => (
                <ShelterCard key={s.id} shelter={s} distanceM={SHELTER_DISTANCE[s.id]} selected={s.id === selectedId} onSelect={() => select(s.id, "list")} />
              ))
            )}
          </div>
        )}
      </MapPanel>
    </div>
  );
}
