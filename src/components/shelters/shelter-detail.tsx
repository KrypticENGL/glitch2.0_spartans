"use client";

import Link from "next/link";
import { ChevronLeft, MapPin, Navigation, Phone } from "lucide-react";
import type { EvacuationRoute, Shelter } from "@/types";
import { L, formatKm, tone } from "@/lib/format";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { FACILITY_ICON, OccupancyLine } from "./shelter-parts";
import { RouteCard } from "@/components/evacuation/route-card";

interface Props {
  shelter: Shelter;
  distanceM?: number;
  routes: EvacuationRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (id: string) => void;
  onBack: () => void;
}

export function ShelterDetail({ shelter, distanceM, routes, selectedRouteId, onSelectRoute, onBack }: Props) {
  const usable = routes.filter((r) => r.classification !== "unavailable");
  const [lng, lat] = shelter.location.coordinates;
  return (
    <article aria-labelledby="shelter-title" className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
        <ChevronLeft /> All shelters
      </Button>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={tone.shelter[shelter.status]}>{L.shelterStatus[shelter.status]}</StatusBadge>
          <DemoBadge label="Simulated shelter" />
        </div>
        <h2 id="shelter-title" className="text-xl leading-tight font-bold">{shelter.name}</h2>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {shelter.kind} · {shelter.location.address ?? shelter.location.area}, {shelter.location.district}
            <span className="block text-xs">{lat.toFixed(4)}° N, {lng.toFixed(4)}° E · {formatKm(distanceM)} by road from you</span>
          </span>
        </p>
      </header>

      <OccupancyLine shelter={shelter} />

      <section aria-labelledby="fac-h" className="space-y-2">
        <h3 id="fac-h" className="text-sm font-semibold">Facilities</h3>
        <ul className="grid grid-cols-2 gap-1.5 text-sm">
          {shelter.facilities.map((f) => {
            const Icon = FACILITY_ICON[f];
            return (
              <li key={f} className="flex items-center gap-2">
                <Icon className="size-4 text-teal" aria-hidden /> {L.facility[f]}
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Access: </span>{shelter.accessibilityNotes}</p>
      </section>

      {shelter.contact && (
        <p className="flex items-center gap-2 text-sm">
          <Phone className="size-4 text-muted-foreground" aria-hidden />
          {shelter.contact.name}: <span className="font-medium">{shelter.contact.phone}</span>
        </p>
      )}

      <section aria-labelledby="routes-h" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 id="routes-h" className="text-sm font-semibold">Routes from your location</h3>
          <span className="text-xs text-muted-foreground">Illustrative</span>
        </div>
        {usable.length === 0 && (
          <p role="status" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">
            Every known road to this shelter is reported impassable. Choose another shelter, or request help through SOS if you cannot move safely.
          </p>
        )}
        <div className="space-y-2">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} compact selected={r.id === selectedRouteId} onSelect={() => onSelectRoute(r.id)} />
          ))}
        </div>
      </section>

      <div className="flex gap-2">
        <Button asChild size="lg" className="flex-1">
          <Link href={`/evacuation?to=${shelter.id}`}>
            <Navigation /> View evacuation routes
          </Link>
        </Button>
        {usable.length === 0 && (
          <Button asChild size="lg" variant="destructive">
            <Link href="/sos">Request help</Link>
          </Button>
        )}
      </div>
    </article>
  );
}
