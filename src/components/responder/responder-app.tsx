"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, HeartPulse, MapPin, Phone, Users } from "lucide-react";
import { toast } from "sonner";
import type { MissionStatus, RescueMission } from "@/types";
import { useDemoStore, MISSION_FLOW } from "@/store/demo-store";
import { api } from "@/services/api";
import { L, formatKm, formatMin, formatTime, tone } from "@/lib/format";
import { missionLeg } from "@/features/rescue/mission-route";
import { MapView } from "@/components/maps/map-view";
import { boundsOf } from "@/components/maps/map-types";
import { Brand } from "@/components/layout/brand";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const ACTION: Partial<Record<MissionStatus, string>> = {
  assigned: "Accept mission",
  accepted: "Start travelling",
  en_route: "Arrived on site",
  on_site: "Complete mission",
};
const STEPS = MISSION_FLOW;

function Stepper({ status }: { status: MissionStatus }) {
  const at = STEPS.indexOf(status);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Mission progress">
      {STEPS.map((s, i) => (
        <li key={s} className="space-y-1" aria-current={i === at ? "step" : undefined}>
          <span className={cn("block h-1.5 rounded-full", i <= at ? "bg-teal" : "bg-muted")} aria-hidden />
          <span className={cn("block text-[11px] leading-tight", i === at ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {i < at && <Check className="mr-0.5 inline size-3" aria-hidden />}
            {L.missionStatus[s]}
            <span className="sr-only">{i < at ? " (done)" : i === at ? " (current)" : ""}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ResponderApp() {
  const teams = useDemoStore((s) => s.teams);
  const missions = useDemoStore((s) => s.missions);
  const incidents = useDemoStore((s) => s.incidents);
  const [teamId, setTeamId] = useState("team-boat-3");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const team = teams.find((t) => t.id === teamId)!;
  const mine = missions.filter((m) => m.teamId === teamId);
  const active = mine.filter((m) => m.status !== "completed");
  const done = mine.filter((m) => m.status === "completed");
  const current: RescueMission | undefined = active.find((m) => m.id === pickedId) ?? active[0];
  const incident = incidents.find((i) => i.id === current?.incidentId);
  const leg = useMemo(() => (incident ? missionLeg(team, incident) : null), [team, incident]);
  const next = current ? STEPS[STEPS.indexOf(current.status) + 1] : undefined;

  async function advance() {
    if (!current || !next) return;
    await api.updateMissionStatus(current.id, next);
    toast.success(`${current.id}: ${L.missionStatus[next]}`, { description: "Operations dashboard updated." });
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Brand href="/responder" sub="Responder" invert />
          <DemoBadge className="ml-auto" label="Demo" />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <label htmlFor="team" className="shrink-0 text-sm text-muted-foreground">Signed in as</label>
          <Select value={teamId} onValueChange={(v) => { setTeamId(v); setPickedId(null); }}>
            <SelectTrigger id="team" className="h-10 flex-1 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.kind})</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {!current || !incident ? (
          <section className="rounded-xl border bg-card p-6 text-center">
            <p className="text-lg font-semibold">No active missions for {team.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">New assignments from the operations room appear here.</p>
            <Button asChild variant="outline" className="mt-4"><Link href="/dashboard/rescue">Open rescue coordination</Link></Button>
          </section>
        ) : (
          <section aria-labelledby="mission-h" className="overflow-hidden rounded-xl border bg-card">
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={tone.priority[incident.priority]}>{L.priority[incident.priority]} priority</StatusBadge>
                <StatusBadge tone={tone.mission[current.status]}>{L.missionStatus[current.status]}</StatusBadge>
                <span className="ml-auto text-xs text-muted-foreground">Updated {formatTime(current.updatedAt)}</span>
              </div>
              <h1 id="mission-h" className="text-xl leading-tight font-bold">{L.incidentType[incident.type]} · {incident.location.area}</h1>
              <p className="text-sm text-muted-foreground">Mission {current.id} · incident {incident.id}</p>
              <Stepper status={current.status} />
            </div>

            <div className="relative h-64 border-y sm:h-80">
              <MapView
                key={current.id}
                compact
                label={`Route preview to ${incident.location.area}`}
                incidents={[incident]}
                teams={[team]}
                routes={leg ? [leg.route] : []}
                selectedRouteId={leg?.route.id}
                selection={{ kind: "incident", id: incident.id }}
                focus={leg ? { id: 1, bounds: boundsOf(leg.route.coordinates) } : null}
              />
            </div>
            {leg && (
              <p className="px-4 pt-3 text-sm">
                <b>{formatKm(leg.distanceM)}</b> from {team.base.area} base{" "}
                {leg.onRoad ? `by road, about ${formatMin(leg.distanceM / 6)} in normal traffic (illustrative).` : "in a straight line. No road route is prepared for this incident; check conditions before travelling."}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
              <div className="flex gap-2"><Users className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">People</dt><dd className="text-lg font-bold">{incident.peopleAffected}</dd></div></div>
              <div className="flex gap-2"><HeartPulse className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">Medical</dt><dd className={cn("font-semibold", incident.medicalNeeded && "text-[#a3241e]")}>{incident.medicalNeeded ? "Needed" : "Not reported"}</dd></div></div>
              <div className="col-span-2 flex gap-2"><MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="sr-only">Location</dt><dd>{incident.location.area}, {incident.location.district} · {incident.location.coordinates[1].toFixed(4)}° N, {incident.location.coordinates[0].toFixed(4)}° E</dd></div></div>
              {incident.notes && <div className="col-span-2 rounded-md bg-secondary p-3"><dt className="text-xs text-muted-foreground">Notes from report</dt><dd>{incident.notes}</dd></div>}
            </dl>

            <div className="space-y-2 border-t p-4">
              {incident.contact ? (
                <Button asChild variant="outline" size="lg" className="h-12 w-full">
                  <a href={`tel:${incident.contact.replace(/\s/g, "")}`}><Phone /> Call reporter ({incident.contact})</a>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">No contact number was given with this report.</p>
              )}
              {next && (
                <Button size="lg" className="h-14 w-full bg-teal text-base text-white hover:bg-teal/90" onClick={() => (next === "completed" ? setConfirmComplete(true) : advance())}>
                  {ACTION[current.status]}
                </Button>
              )}
            </div>
          </section>
        )}

        {active.length > 1 && (
          <section aria-labelledby="queue-h" className="space-y-2">
            <h2 id="queue-h" className="font-semibold">Other assigned missions</h2>
            <ul className="space-y-2">
              {active.filter((m) => m.id !== current?.id).map((m) => {
                const inc = incidents.find((i) => i.id === m.incidentId);
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => setPickedId(m.id)} className="flex w-full items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left">
                      <span>
                        <span className="block font-semibold">{inc && L.incidentType[inc.type]} · {inc?.location.area}</span>
                        <span className="block text-sm text-muted-foreground">{m.id} · {L.missionStatus[m.status]}</span>
                      </span>
                      {inc && <StatusBadge tone={tone.priority[inc.priority]}>{L.priority[inc.priority]}</StatusBadge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {done.length > 0 && (
          <details className="rounded-lg border bg-card p-3">
            <summary className="cursor-pointer font-semibold">Completed today ({done.length})</summary>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {done.map((m) => <li key={m.id}>{m.id} · incident {m.incidentId} · completed {formatTime(m.updatedAt)}</li>)}
            </ul>
          </details>
        )}

        <p className="text-xs text-muted-foreground">Team lead: {team.lead.name} · {team.lead.phone}. Status changes here update the operations dashboard on this device.</p>
      </main>

      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete mission {current?.id}?</AlertDialogTitle>
            <AlertDialogDescription>The incident will be marked resolved and {team.name} becomes available for new assignments.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={advance}>Complete mission</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
