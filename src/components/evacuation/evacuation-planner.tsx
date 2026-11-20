"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { MapView } from "@/components/maps/map-view";
import { MapPanel, sheetPx, type SheetSize } from "@/components/maps/map-panel";
import { boundsOf, nextFocus, type CameraFocus, type MapSelection } from "@/components/maps/map-types";
import { RouteCard, RouteSwatch } from "./route-card";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDemoStore } from "@/store/demo-store";
import { getRoutesToShelter } from "@/features/routing/adapter";
import { SHELTER_DISTANCE } from "@/features/shelters/selectors";
import { DEMO_ORIGIN } from "@/data/mock/seed";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { L, formatKm, spacesLeft, tone } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import type { RouteClassification } from "@/types";

const LEGEND: RouteClassification[] = ["recommended", "alternative", "caution", "unavailable"];

export function EvacuationPlanner() {
  const params = useSearchParams();
  const router = useRouter();
  const shelters = useDemoStore((s) => s.shelters);
  const isMobile = useIsMobile();

  const fallback = useMemo(
    () => [...shelters].filter((s) => s.status === "open").sort((a, b) => (SHELTER_DISTANCE[a.id] ?? 1e9) - (SHELTER_DISTANCE[b.id] ?? 1e9))[0]?.id,
    [shelters],
  );
  const shelterId = shelters.some((s) => s.id === params.get("to")) ? params.get("to")! : fallback;
  const shelter = shelters.find((s) => s.id === shelterId);
  const routes = useMemo(() => (shelterId ? getRoutesToShelter(shelterId) : []), [shelterId]);

  const [pickedRoute, setPickedRoute] = useState<{ shelterId?: string; routeId: string } | null>(null);
  const routeId = pickedRoute?.shelterId === shelterId ? pickedRoute.routeId : routes[0]?.id;
  const [sheet, setSheet] = useState<SheetSize>("half");
  const [focus, setFocus] = useState<CameraFocus | null>(() => (routes[0] ? { id: 1, bounds: boundsOf(routes[0].coordinates) } : null));

  const padding = isMobile ? { top: 60, right: 60, bottom: sheetPx(sheet) + 20, left: 30 } : { top: 60, right: 70, bottom: 60, left: 440 };

  function selectRoute(id: string) {
    setPickedRoute({ shelterId, routeId: id });
    const r = routes.find((x) => x.id === id);
    if (r) setFocus((f) => nextFocus(f, { bounds: boundsOf(r.coordinates) }));
  }

  function chooseShelter(id: string) {
    router.replace(`/evacuation?to=${id}`, { scroll: false });
    const r = getRoutesToShelter(id)[0];
    if (r) setFocus((f) => nextFocus(f, { bounds: boundsOf(r.coordinates) }));
  }

  const onMapSelect = (sel: MapSelection) => sel.kind === "shelter" && chooseShelter(sel.id);
  const selectedRoute = routes.find((r) => r.id === routeId);

  const header = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Evacuation routes</h1>
        <DemoBadge label="Illustrative" />
      </div>
      <div className="space-y-1">
        <label htmlFor="dest" className="text-xs font-medium text-muted-foreground">From {DEMO_ORIGIN.label.toLowerCase()} to</label>
        <Select value={shelterId} onValueChange={chooseShelter}>
          <SelectTrigger id="dest" className="h-10 w-full bg-card">
            <SelectValue placeholder="Choose a shelter" />
          </SelectTrigger>
          <SelectContent>
            {shelters.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} · {L.shelterStatus[s.status]} · {formatKm(SHELTER_DISTANCE[s.id])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-3.5rem-4rem)] md:h-[calc(100dvh-3.5rem)]">
      <MapView
        label="3D map of evacuation routes"
        shelters={shelter ? [shelter] : []}
        roads={ROAD_SEGMENTS}
        routes={routes}
        selectedRouteId={routeId}
        onSelectRoute={selectRoute}
        origin={DEMO_ORIGIN}
        selection={shelter ? { kind: "shelter", id: shelter.id } : null}
        onSelect={onMapSelect}
        focus={focus}
        padding={padding}
      />

      <MapPanel title="Route options" header={header} size={sheet} onSizeChange={setSheet}>
        {shelter && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{shelter.name}</span>
              <span className="block text-xs text-muted-foreground">{shelter.status === "closed" ? "Not accepting people" : `${spacesLeft(shelter)} spaces left`}</span>
            </span>
            <StatusBadge tone={tone.shelter[shelter.status]}>{L.shelterStatus[shelter.status]}</StatusBadge>
          </div>
        )}
        {routes.length > 0 && routes.every((r) => r.classification === "unavailable") && (
          <p role="status" className="mb-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">
            No passable road is known to this shelter right now. Pick another destination, or use SOS if you are trapped.
          </p>
        )}
        <ul className="space-y-2" aria-label="Route options">
          {routes.map((r) => (
            <li key={r.id}>
              <RouteCard route={r} selected={r.id === routeId} onSelect={() => selectRoute(r.id)} />
            </li>
          ))}
        </ul>
        <div aria-live="polite" className="sr-only">
          {selectedRoute && `${selectedRoute.label} selected: ${L.route[selectedRoute.classification]}, ${formatKm(selectedRoute.distanceM)}.`}
        </div>

        <div className="mt-4 space-y-2 border-t pt-3">
          <p className="text-xs font-semibold">Map key</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {LEGEND.map((c) => (
              <li key={c} className="flex items-center gap-2"><RouteSwatch c={c} /> {L.route[c]}</li>
            ))}
          </ul>
          <p className="flex gap-2 pt-1 text-xs leading-snug text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Road geometry comes from OpenStreetMap. Closures and water levels are simulated, and no route here is officially validated. Follow instructions from local authorities.
          </p>
        </div>
      </MapPanel>
    </div>
  );
}
