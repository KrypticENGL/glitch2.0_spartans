"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { computeMetrics } from "@/lib/metrics";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { L, formatTime, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { MapView } from "@/components/maps/map-view";
import type { MapSelection } from "@/components/maps/map-types";
import { Meter, StatusBadge, toneText } from "@/components/shared/status";
import { IncidentSheet } from "@/components/incidents/incident-sheet";
import { PRIORITY_RANK } from "@/features/incidents/sort";
import { cn } from "@/lib/utils";

function Stat({ label, value, sub, alert }: { label: string; value: string | number; sub: string; alert?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-2xl leading-none font-bold", alert && "text-[#a3241e]")}>{value}</dd>
      <dd className="mt-1.5 text-xs text-muted-foreground">{sub}</dd>
    </div>
  );
}

export function DashboardOverview() {
  const shelters = useDemoStore((s) => s.shelters);
  const incidents = useDemoStore((s) => s.incidents);
  const missions = useDemoStore((s) => s.missions);
  const teams = useDemoStore((s) => s.teams);
  const hazards = useDemoStore((s) => s.hazards);
  const m = useMemo(() => computeMetrics({ shelters, incidents, missions, teams }), [shelters, incidents, missions, teams]);
  const [openId, setOpenId] = useState<string | null>(null);

  const queue = useMemo(
    () => incidents.filter((i) => i.status !== "resolved").sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.reportedAt.localeCompare(a.reportedAt)),
    [incidents],
  );
  const onSelect = (sel: MapSelection) => sel.kind === "incident" && setOpenId(sel.id);

  return (
    <div className="space-y-4 p-3 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Darbhanga district · demonstration state</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Situation overview</h2>
        </div>
        <p className="text-xs text-muted-foreground">Map, incidents and resource capacity</p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active incidents" value={m.activeIncidents} sub={`${m.criticalIncidents} critical · ${m.unassignedIncidents} without a team`} alert={m.unassignedIncidents > 0} />
        <Stat label="People awaiting help" value={m.peopleAwaiting} sub="Across open incidents" />
        <Stat label="Citizen SOS requests" value={m.sosRequests} sub="Submitted in this demo session" />
        <Stat label="Shelters accepting" value={`${m.sheltersAccepting}/${m.sheltersTotal}`} sub={`${m.spaces} spaces free of ${m.capacity}`} />
        <Stat label="Shelter occupancy" value={`${m.occupancyPct}%`} sub={`${m.occupancy} people in operating shelters`} />
        <Stat label="Roads impassable" value={`${m.roadsImpassable}/${m.roadsMonitored}`} sub={`${m.activeMissions} missions active · ${m.teamsAvailable} teams free`} alert={m.roadsImpassable > 0} />
      </dl>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <section aria-label="Situation map" className="relative h-[420px] overflow-hidden rounded-lg border bg-card xl:h-[590px]">
          <MapView
            label="Operations overview map"
            compact
            shelters={shelters}
            incidents={incidents}
            teams={teams}
            hazards={hazards}
            roads={ROAD_SEGMENTS}
            selection={openId ? { kind: "incident", id: openId } : null}
            onSelect={onSelect}
          />
          <Link href="/dashboard/map" className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-sm font-semibold shadow-sm hover:bg-muted">
            Open full operations map <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </section>

        <section aria-labelledby="queue-h" className="flex max-h-[560px] flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="queue-h" className="font-semibold">Incident queue</h2>
            <Link href="/dashboard/incidents" className="text-sm font-semibold text-[#0a6567] hover:underline">All incidents</Link>
          </div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {queue.length === 0 && <li className="p-4 text-sm text-muted-foreground">No open incidents.</li>}
            {queue.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setOpenId(i.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", { critical: "bg-danger", high: "bg-warn", medium: "bg-info", low: "bg-muted-tone" }[i.priority])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{i.id} · {L.incidentType[i.type]}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(i.reportedAt)}</span>
                    </span>
                    <span className="block text-sm text-muted-foreground">{i.location.area} · {i.peopleAffected} {i.peopleAffected === 1 ? "person" : "people"}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge tone={tone.priority[i.priority]}>{L.priority[i.priority]}</StatusBadge>
                      <StatusBadge tone={tone.incident[i.status]}>{L.incidentStatus[i.status]}</StatusBadge>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="occ-h" className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="occ-h" className="font-semibold">Shelter occupancy</h2>
            <Link href="/dashboard/shelters" className="text-sm font-semibold text-[#0a6567] hover:underline">Manage</Link>
          </div>
          <ul className="divide-y">
            {[...shelters].sort((a, b) => occupancyPct(b) - occupancyPct(a)).map((s) => (
              <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <span className={cn("text-xs font-semibold", toneText[tone.shelter[s.status]])}>{L.shelterStatus[s.status]} · {s.status === "closed" ? "—" : `${spacesLeft(s)} free`}</span>
                <Meter value={occupancyPct(s)} tone={tone.shelter[s.status]} label={`${s.name} occupancy`} />
                <span className="w-10 text-right text-xs text-muted-foreground">{occupancyPct(s)}%</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="teams-h" className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="teams-h" className="font-semibold">Responder activity</h2>
            <Link href="/dashboard/rescue" className="text-sm font-semibold text-[#0a6567] hover:underline">Coordinate</Link>
          </div>
          <ul className="divide-y">
            {teams.map((t) => {
              const active = missions.filter((ms) => ms.teamId === t.id && ms.status !== "completed");
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.kind} · {t.members} people · {active.length ? active.map((a) => `${a.incidentId} (${L.missionStatus[a.status].toLowerCase()})`).join(", ") : "no active mission"}
                    </span>
                  </span>
                  <StatusBadge tone={t.availability === "available" ? "ok" : t.availability === "on_mission" ? "info" : "muted"}>
                    {t.availability === "available" ? "Available" : t.availability === "on_mission" ? "On mission" : "Off duty"}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <IncidentSheet incidentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
