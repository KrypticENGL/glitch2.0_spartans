"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, LocateFixed, Navigation, Phone, TriangleAlert } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { SEED_ALERTS, DEMO_ORIGIN } from "@/data/mock/seed";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { SHELTER_DISTANCE } from "@/features/shelters/selectors";
import { getRoutesToShelter } from "@/features/routing/adapter";
import { L, formatKm, formatMin, formatTime, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { Meter, StatusBadge } from "@/components/shared/status";
import { MapView } from "@/components/maps/map-view";
import { nextFocus, type CameraFocus, type MapSelection } from "@/components/maps/map-types";
import { Button } from "@/components/ui/button";

export function CitizenHome() {
  const shelters = useDemoStore((s) => s.shelters);
  const nearest = [...shelters]
    .filter((s) => s.status === "open" || s.status === "near_capacity")
    .sort((a, b) => (SHELTER_DISTANCE[a.id] ?? 1e9) - (SHELTER_DISTANCE[b.id] ?? 1e9));
  const best = nearest.find((s) => getRoutesToShelter(s.id).some((r) => r.classification === "recommended"));
  const [selectedId, setSelectedId] = useState<string | null>(best?.id ?? null);
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const selected = shelters.find((s) => s.id === selectedId) ?? best;
  const selectedRoutes = selected ? getRoutesToShelter(selected.id) : [];
  const bestRoute = selectedRoutes.find((r) => r.classification === "recommended") ?? selectedRoutes[0];
  const top = SEED_ALERTS[0];

  function onMapSelect(selection: MapSelection) {
    if (selection.kind === "shelter") setSelectedId(selection.id);
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-4 md:px-7 md:py-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            <LocateFixed className="size-3.5 text-teal" aria-hidden /> YOUR AREA
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] md:text-[28px]">{DEMO_ORIGIN.area}, Darbhanga</h1>
        </div>
        <p className="text-sm text-muted-foreground">Flood response · Bihar</p>
      </header>

      <Link href="/alerts" className="group flex items-center gap-3 border-y border-danger/25 py-3.5" aria-label={`${L.alert[top.severity]} alert: ${top.title}. View alert details`}>
        <span className="h-8 w-1 shrink-0 rounded-full bg-danger" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusBadge tone="danger">{L.alert[top.severity]}</StatusBadge>
            <span className="font-semibold">{top.title}</span>
            <span className="text-xs text-muted-foreground">{formatTime(top.issuedAt)}</span>
          </span>
          <span className="mt-1 block line-clamp-1 text-sm text-muted-foreground">{top.body}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>

      <section aria-label="Shelters and evacuation map" className="grid min-h-[610px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="relative min-h-[360px] border-b lg:min-h-[610px] lg:border-b-0 lg:border-r">
          <MapView
            label="Interactive 3D map of nearby shelters and evacuation routes"
            shelters={nearest}
            roads={ROAD_SEGMENTS}
            routes={bestRoute ? [{ id: bestRoute.id, label: "Recommended route", classification: bestRoute.classification, coordinates: bestRoute.coordinates }] : []}
            selectedRouteId={bestRoute?.id ?? null}
            origin={DEMO_ORIGIN}
            selection={selected ? { kind: "shelter", id: selected.id } : null}
            onSelect={onMapSelect}
            focus={focus}
            compact
          />
          <div className="pointer-events-none absolute top-3 left-3 rounded-md border bg-card/95 px-3 py-2 text-xs font-medium shadow-sm">
            <span className="mr-2 inline-block size-2 rounded-full bg-teal" aria-hidden />
            Darbhanga response area
          </div>
          <Link href="/shelters" className="absolute right-3 bottom-3 rounded-md border bg-card px-3 py-2 text-xs font-semibold shadow-sm hover:bg-muted">Explore shelter map</Link>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="border-b px-4 py-4 md:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Evacuate nearby</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Open shelters, sorted by distance</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{nearest.length} locations</span>
            </div>
          </div>

          {selected && bestRoute ? (
            <div className="border-b bg-[#f2f8f7] px-4 py-4 md:px-5">
              <p className="text-[11px] font-semibold text-teal">RECOMMENDED DESTINATION</p>
              <h3 className="mt-1 text-base font-semibold leading-snug">{selected.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{selected.location.area} · {formatKm(bestRoute.distanceM)} · {formatMin(bestRoute.durationS)} by vehicle</p>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-ok">{spacesLeft(selected)} spaces available</span>
                <span className="text-muted-foreground">{selected.capacity} total</span>
              </div>
              <Meter className="mt-1.5" value={occupancyPct(selected)} tone={tone.shelter[selected.status]} label={`${selected.name} occupancy`} />
              <Button asChild className="mt-4 h-10 w-full bg-teal text-white hover:bg-teal/90">
                <Link href={`/evacuation?to=${selected.id}`}><Navigation /> Start this route</Link>
              </Button>
            </div>
          ) : (
            <p className="border-b px-5 py-5 text-sm text-muted-foreground">No shelter currently has a recommended route. Request rescue if you need help.</p>
          )}

          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {nearest.slice(0, 4).map((s) => {
              const active = selected?.id === s.id;
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => {
                    setSelectedId(s.id);
                    setFocus((f) => nextFocus(f, { center: s.location.coordinates, zoom: 14 }));
                  }} aria-pressed={active} className={`w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 md:px-5 ${active ? "bg-[#f5f8f7]" : ""}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{s.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{s.location.area} · {formatKm(SHELTER_DISTANCE[s.id])} away</span>
                      </span>
                      <StatusBadge tone={tone.shelter[s.status]}>{L.shelterStatus[s.status]}</StatusBadge>
                    </span>
                    <span className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-medium">{spacesLeft(s)} spaces free</span>
                      <span className="text-muted-foreground">{occupancyPct(s)}% occupied</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/shelters" className="flex items-center justify-between border-t px-4 py-3 text-sm font-semibold text-teal hover:bg-muted/40 md:px-5">
            All shelters <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>

      <section aria-label="Emergency assistance" className="flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"><TriangleAlert className="size-4" aria-hidden /></span>
          <div>
            <h2 className="font-semibold">Need urgent help?</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Send a rescue request to the response team. This demo does not contact emergency services.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 pl-12 sm:pl-0">
          <Button asChild className="h-10 bg-danger text-white hover:bg-danger/90"><Link href="/sos">Request rescue</Link></Button>
          <Button asChild variant="outline" className="h-10"><a href="tel:112"><Phone /> Call 112</a></Button>
        </div>
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">Demonstration data for Darbhanga; conditions shown are simulated. For a real emergency in India, call <b className="text-foreground">112</b>.</p>
    </div>
  );
}
