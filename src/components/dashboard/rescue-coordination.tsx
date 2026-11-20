"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { MissionStatus, RescueMission } from "@/types";
import { useDemoStore, MISSION_FLOW } from "@/store/demo-store";
import { api } from "@/services/api";
import { L, formatKm, formatTime, tone } from "@/lib/format";
import { PRIORITY_RANK } from "@/features/incidents/sort";
import { missionLeg } from "@/features/rescue/mission-route";
import { MapView } from "@/components/maps/map-view";
import { boundsOf, nextFocus, type CameraFocus, type MapRoute } from "@/components/maps/map-types";
import { IncidentSheet } from "@/components/incidents/incident-sheet";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function RescueCoordination() {
  const incidents = useDemoStore((s) => s.incidents);
  const teams = useDemoStore((s) => s.teams);
  const missions = useDemoStore((s) => s.missions);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [openIncident, setOpenIncident] = useState<string | null>(null);
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const [assignPick, setAssignPick] = useState<Record<string, string>>({});

  const visibleMissions = missions.filter((m) => !teamFilter || m.teamId === teamFilter);
  const unassigned = incidents.filter((i) => i.status === "new" && !i.assignedTeamId).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  const legs = useMemo(() => {
    const out: (MapRoute & { missionId: string })[] = [];
    for (const m of visibleMissions) {
      if (m.status === "completed") continue;
      const t = teams.find((x) => x.id === m.teamId);
      const i = incidents.find((x) => x.id === m.incidentId);
      if (t && i) out.push({ ...missionLeg(t, i).route, id: `leg:${m.id}`, missionId: m.id });
    }
    return out;
  }, [visibleMissions, teams, incidents]);

  const activeIncidentIds = new Set(visibleMissions.filter((m) => m.status !== "completed").map((m) => m.incidentId));
  const mapIncidents = incidents.filter((i) => activeIncidentIds.has(i.id) || (!teamFilter && i.status === "new"));

  function focusMission(m: RescueMission) {
    setMissionId(m.id);
    const leg = legs.find((l) => l.missionId === m.id);
    if (leg) setFocus((f) => nextFocus(f, { bounds: boundsOf(leg.coordinates) }));
  }

  async function advance(m: RescueMission, next: MissionStatus) {
    await api.updateMissionStatus(m.id, next);
    toast.success(`${m.id}: ${L.missionStatus[next]}`, { description: `Incident ${m.incidentId} updated across all views.` });
  }

  async function quickAssign(incidentId: string) {
    const teamId = assignPick[incidentId];
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;
    await api.assignRescueTeam(incidentId, teamId);
    toast.success(`${team.name} assigned to ${incidentId}`);
    setAssignPick((p) => ({ ...p, [incidentId]: "" }));
  }

  return (
    <div className="space-y-4 p-3 md:p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <section aria-label="Mission map" className="relative h-[380px] overflow-hidden rounded-lg border">
          <MapView
            label="Rescue missions map"
            compact
            incidents={mapIncidents}
            teams={teamFilter ? teams.filter((t) => t.id === teamFilter) : teams}
            routes={legs}
            selectedRouteId={missionId ? `leg:${missionId}` : null}
            onSelectRoute={(id) => { const m = missions.find((x) => `leg:${x.id}` === id); if (m) focusMission(m); }}
            selection={teamFilter ? { kind: "team", id: teamFilter } : null}
            onSelect={(sel) => (sel.kind === "team" ? setTeamFilter(sel.id) : sel.kind === "incident" && setOpenIncident(sel.id))}
            focus={focus}
          />
        </section>
        <section aria-labelledby="teams-h" className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="teams-h" className="font-semibold">Teams</h2>
            {teamFilter && <Button variant="link" size="sm" onClick={() => setTeamFilter(null)}>Show all</Button>}
          </div>
          <ul className="divide-y">
            {teams.map((t) => {
              const n = missions.filter((m) => m.teamId === t.id && m.status !== "completed").length;
              return (
                <li key={t.id}>
                  <button type="button" aria-pressed={teamFilter === t.id} onClick={() => setTeamFilter(teamFilter === t.id ? null : t.id)} className={cn("flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-muted/60", teamFilter === t.id && "bg-accent/60")}>
                    <span>
                      <span className="block text-sm font-medium">{t.name}</span>
                      <span className="block text-xs text-muted-foreground">{t.kind} · {t.members} people · {n} active</span>
                    </span>
                    <StatusBadge tone={t.availability === "available" ? "ok" : "info"}>{t.availability === "available" ? "Available" : "On mission"}</StatusBadge>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Teams appear at their base. Live position tracking is not simulated.</p>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <section aria-labelledby="col-unassigned" className="rounded-lg border border-danger/30 bg-card">
          <h2 id="col-unassigned" className="flex items-center justify-between border-b px-3 py-2.5 text-sm font-semibold">Awaiting a team <span className="text-[#a3241e]">{unassigned.length}</span></h2>
          <ul className="space-y-2 p-2">
            {unassigned.length === 0 && <li className="p-2 text-sm text-muted-foreground">Every new incident has a team.</li>}
            {unassigned.map((i) => (
              <li key={i.id} className="space-y-2 rounded-md border p-2.5">
                <button type="button" className="block w-full text-left" onClick={() => setOpenIncident(i.id)}>
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">{i.id}<StatusBadge tone={tone.priority[i.priority]}>{L.priority[i.priority]}</StatusBadge></span>
                  <span className="block text-xs text-muted-foreground">{L.incidentType[i.type]} · {i.location.area} · {i.peopleAffected} people</span>
                </button>
                <div className="flex gap-1.5">
                  <Select value={assignPick[i.id] ?? ""} onValueChange={(v) => setAssignPick((p) => ({ ...p, [i.id]: v }))}>
                    <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={`Team for ${i.id}`}><SelectValue placeholder="Team…" /></SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.availability === "available" ? " · free" : " · busy"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!assignPick[i.id]} onClick={() => quickAssign(i.id)}>Assign</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {MISSION_FLOW.map((status) => {
          const col = visibleMissions.filter((m) => m.status === status);
          return (
            <section key={status} aria-labelledby={`col-${status}`} className="rounded-lg border bg-card">
              <h2 id={`col-${status}`} className="flex items-center justify-between border-b px-3 py-2.5 text-sm font-semibold">{L.missionStatus[status]} <span className="text-muted-foreground">{col.length}</span></h2>
              <ul className="space-y-2 p-2">
                {col.length === 0 && <li className="p-2 text-sm text-muted-foreground">None</li>}
                {col.map((m) => {
                  const inc = incidents.find((i) => i.id === m.incidentId);
                  const team = teams.find((t) => t.id === m.teamId);
                  const next = MISSION_FLOW[MISSION_FLOW.indexOf(m.status) + 1];
                  const leg = inc && team ? missionLeg(team, inc) : null;
                  return (
                    <li key={m.id} className={cn("rounded-md border p-2.5", missionId === m.id && "border-teal shadow-[0_0_0_1px_var(--teal)]")}>
                      <button type="button" className="block w-full text-left" onClick={() => focusMission(m)}>
                        <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                          {m.id}
                          {inc && <StatusBadge tone={tone.priority[inc.priority]}>{L.priority[inc.priority]}</StatusBadge>}
                        </span>
                        <span className="block text-xs text-muted-foreground">{team?.name} → {inc?.id} · {inc?.location.area}</span>
                        {leg && m.status !== "completed" && <span className="block text-xs text-muted-foreground">{formatKm(leg.distanceM)} {leg.onRoad ? "by road" : "straight line"} · updated {formatTime(m.updatedAt)}</span>}
                      </button>
                      {next && (
                        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => advance(m, next)}>
                          Mark {L.missionStatus[next].toLowerCase()}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <IncidentSheet incidentId={openIncident} onClose={() => setOpenIncident(null)} />
    </div>
  );
}
