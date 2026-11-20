"use client";

import { useMemo } from "react";
import type { IncidentType, Priority, RoadCondition } from "@/types";
import { useDemoStore, MISSION_FLOW } from "@/store/demo-store";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { computeMetrics } from "@/lib/metrics";
import { L, tone, type Tone } from "@/lib/format";
import { toneBar } from "@/components/shared/status";
import { cn } from "@/lib/utils";

interface Row { label: string; value: number; tone?: Tone; note?: string }

/** Horizontal bars with the value printed beside each bar (no colour-only encoding). */
function BarList({ rows, unit }: { rows: Row[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(7rem,10rem)_1fr_3.5rem] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>{r.label}</span>
          <span className="h-3 overflow-hidden rounded-sm bg-muted" aria-hidden>
            <span className={cn("block h-full rounded-sm", toneBar[r.tone ?? "info"])} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-semibold">{r.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{sub}</p>
      {children}
    </section>
  );
}

export function Analytics() {
  const shelters = useDemoStore((s) => s.shelters);
  const incidents = useDemoStore((s) => s.incidents);
  const missions = useDemoStore((s) => s.missions);
  const teams = useDemoStore((s) => s.teams);
  const m = useMemo(() => computeMetrics({ shelters, incidents, missions, teams }), [shelters, incidents, missions, teams]);
  const open = incidents.filter((i) => i.status !== "resolved");
  const maxCap = Math.max(1, ...shelters.map((s) => s.capacity));

  const byPriority = (Object.keys(L.priority) as Priority[]).map((p) => ({ label: L.priority[p], value: open.filter((i) => i.priority === p).length, tone: tone.priority[p] }));
  const byType = (Object.keys(L.incidentType) as IncidentType[]).map((t) => ({ label: L.incidentType[t], value: open.filter((i) => i.type === t).length })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const pipeline = MISSION_FLOW.map((s) => ({ label: L.missionStatus[s], value: missions.filter((x) => x.status === s).length, tone: tone.mission[s] }));
  const roads = (["blocked", "flooded", "caution"] as RoadCondition[]).map((c) => ({ label: L.road[c], value: ROAD_SEGMENTS.filter((r) => r.condition === c).length, tone: tone.road[c] }));
  const areas = Object.entries(open.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.location.area]: (acc[i.location.area] ?? 0) + i.peopleAffected }), {}))
    .map(([label, value]) => ({ label, value, tone: "warn" as Tone }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4 p-3 md:p-4">
      <p className="text-sm text-muted-foreground">
        A snapshot of the current demonstration state. No historical time series is simulated, so there are no trend charts.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Shelter capacity" sub={`${m.occupancy} of ${m.capacity} places in operating shelters are taken (${m.occupancyPct}%).`}>
          <ul className="space-y-2.5">
            {[...shelters].sort((a, b) => b.capacity - a.capacity).map((s) => (
              <li key={s.id} className="grid grid-cols-[minmax(7rem,10rem)_1fr_5.5rem] items-center gap-3 text-sm">
                <span className="truncate" title={s.name}>{s.name}</span>
                <span className="flex h-3 overflow-hidden rounded-sm bg-muted" aria-hidden style={{ width: `${(s.capacity / maxCap) * 100}%` }}>
                  <span className={cn("h-full", toneBar[tone.shelter[s.status]])} style={{ width: `${(s.occupancy / s.capacity) * 100}%` }} />
                </span>
                <span className="text-right text-xs"><b className="text-sm">{s.occupancy}</b> / {s.capacity}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Bar length is capacity; the filled part is occupancy.</p>
        </Panel>
        <Panel title="People awaiting help by area" sub={`${m.peopleAwaiting} people across ${m.activeIncidents} open incidents.`}>
          <BarList rows={areas} />
        </Panel>
        <Panel title="Open incidents by priority" sub={`${m.unassignedIncidents} open incidents have no team yet.`}>
          <BarList rows={byPriority} />
        </Panel>
        <Panel title="Open incidents by type" sub="What people are reporting.">
          {byType.length ? <BarList rows={byType} /> : <p className="text-sm text-muted-foreground">No open incidents.</p>}
        </Panel>
        <Panel title="Mission pipeline" sub={`${m.activeMissions} active missions · ${m.teamsAvailable} of ${m.teamsTotal} teams available.`}>
          <BarList rows={pipeline} />
        </Panel>
        <Panel title="Monitored road segments" sub={`${m.roadsImpassable} of ${m.roadsMonitored} monitored segments are impassable.`}>
          <BarList rows={roads} />
        </Panel>
      </div>
    </div>
  );
}
