"use client";

import Link from "next/link";
import { ArrowUpRight, LifeBuoy, LocateFixed, Navigation, TriangleAlert } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { SEED_ALERTS, DEMO_ORIGIN } from "@/data/mock/seed";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { SHELTER_DISTANCE } from "@/features/shelters/selectors";
import { getRoutesToShelter } from "@/features/routing/adapter";
import { L, formatKm, formatMin, formatTime, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { Meter, StatusBadge } from "@/components/shared/status";
import { AlertItem } from "./alert-item";
import { Button } from "@/components/ui/button";

export function CitizenHome() {
  const shelters = useDemoStore((s) => s.shelters);
  const nearest = [...shelters]
    .filter((s) => s.status === "open" || s.status === "near_capacity")
    .sort((a, b) => (SHELTER_DISTANCE[a.id] ?? 1e9) - (SHELTER_DISTANCE[b.id] ?? 1e9));
  // Best destination: nearest shelter with space that has a non-blocked route.
  const best = nearest.find((s) => getRoutesToShelter(s.id).some((r) => r.classification === "recommended"));
  const bestRoute = best ? getRoutesToShelter(best.id)[0] : undefined;
  const closed = ROAD_SEGMENTS.filter((r) => r.condition === "blocked" || r.condition === "flooded");
  const top = SEED_ALERTS[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-5 md:py-8">
      <section aria-labelledby="loc-h" className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LocateFixed className="size-4" aria-hidden /> {DEMO_ORIGIN.label}
        </p>
        <h1 id="loc-h" className="text-[26px] leading-tight font-bold md:text-3xl">{DEMO_ORIGIN.area}, Darbhanga</h1>
      </section>

      <Link href="/alerts" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/[0.06] p-3.5 hover:bg-danger/10">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">{L.alert[top.severity]} alert</StatusBadge>
            <span className="text-xs text-muted-foreground">Issued {formatTime(top.issuedAt)}</span>
          </span>
          <span className="mt-1 block font-semibold">{top.title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{top.body}</span>
        </span>
      </Link>

      <section aria-label="Emergency actions" className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl bg-primary p-5 text-primary-foreground">
          <p className="text-sm text-[#9fb3c6]">Suggested shelter</p>
          {best && bestRoute ? (
            <>
              <p className="mt-1 text-xl font-bold">{best.name}</p>
              <p className="mt-1 text-sm text-[#c7d2dd]">
                {formatKm(bestRoute.distanceM)} · about {formatMin(bestRoute.durationS)} by vehicle · {spacesLeft(best)} spaces left
              </p>
              <Button asChild size="lg" className="mt-4 h-12 w-full bg-teal text-base text-white hover:bg-teal/90 md:w-auto md:px-6">
                <Link href={`/evacuation?to=${best.id}`}><Navigation /> Start evacuation route</Link>
              </Button>
            </>
          ) : (
            <p className="mt-1">No shelter currently has a passable route. Use SOS to request rescue.</p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="h-auto flex-1 justify-start gap-3 bg-danger p-5 text-left text-white hover:bg-danger/90">
            <Link href="/sos">
              <LifeBuoy className="size-6!" />
              <span>
                <span className="block text-lg font-bold">Request rescue</span>
                <span className="block text-sm font-normal opacity-90">Demo SOS: not sent to emergency services</span>
              </span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 justify-start bg-card">
            <Link href="/reports"><TriangleAlert /> Report a road hazard</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="near-h" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="near-h" className="text-lg font-bold">Shelters with space near you</h2>
          <Link href="/shelters" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0a6567] hover:underline">
            Open map <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
        <ul className="grid gap-2.5 md:grid-cols-3">
          {nearest.slice(0, 3).map((s) => (
            <li key={s.id}>
              <Link href={`/evacuation?to=${s.id}`} className="block rounded-lg border bg-card p-3.5 hover:border-primary/30">
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <StatusBadge tone={tone.shelter[s.status]}>{L.shelterStatus[s.status]}</StatusBadge>
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{s.location.area} · {formatKm(SHELTER_DISTANCE[s.id])}</span>
                <span className="mt-3 block text-sm"><b>{spacesLeft(s)}</b> of {s.capacity} spaces free</span>
                <Meter className="mt-1.5" value={occupancyPct(s)} tone={tone.shelter[s.status]} label={`${s.name} occupancy`} />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="roads-h" className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h2 id="roads-h" className="text-lg font-bold">Roads to avoid</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {closed.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 p-3">
                <span>
                  <span className="block text-sm font-semibold">{r.name}</span>
                  <span className="block text-sm text-muted-foreground">{r.note}</span>
                </span>
                <StatusBadge tone={tone.road[r.condition]}>{L.road[r.condition]}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Other alerts</h2>
            <Link href="/alerts" className="text-sm font-semibold text-[#0a6567] hover:underline">All alerts</Link>
          </div>
          <ul className="space-y-2">
            {SEED_ALERTS.slice(1).map((a) => <AlertItem key={a.id} alert={a} />)}
          </ul>
        </div>
      </section>

      <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
        SURAKSHA is running in demonstration mode. Shelters, alerts and road conditions are simulated for Darbhanga and do not reflect a real flood. In a real emergency in India, call <b className="text-foreground">112</b>.
      </p>
    </div>
  );
}
