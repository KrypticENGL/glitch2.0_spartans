"use client";

import { useState } from "react";
import { Clock, HeartPulse, MapPin, Phone, Users } from "lucide-react";
import { toast } from "sonner";
import type { Incident, Priority } from "@/types";
import { useDemoStore, MISSION_FLOW } from "@/store/demo-store";
import { api } from "@/services/api";
import { L, formatDateTime, formatKm, tone } from "@/lib/format";
import { missionLeg } from "@/features/rescue/mission-route";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

const PRIORITIES = Object.keys(L.priority) as Priority[];

export function IncidentDetail({ incident }: { incident: Incident }) {
  const teams = useDemoStore((s) => s.teams);
  const mission = useDemoStore((s) => s.missions.find((m) => m.incidentId === incident.id && m.status !== "completed"));
  const updatePriority = useDemoStore((s) => s.updateIncidentPriority);
  const [teamId, setTeamId] = useState<string>("");
  const [confirm, setConfirm] = useState<null | "reassign" | "resolve">(null);

  const team = teams.find((t) => t.id === incident.assignedTeamId);
  const resolved = incident.status === "resolved";
  const nextStep = mission ? MISSION_FLOW[MISSION_FLOW.indexOf(mission.status) + 1] : undefined;
  const candidate = teams.find((t) => t.id === teamId);

  async function assign() {
    if (!candidate) return;
    await api.assignRescueTeam(incident.id, candidate.id);
    toast.success(`${candidate.name} assigned to ${incident.id}`, { description: "The mission now appears in the responder app." });
    setTeamId("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={tone.priority[incident.priority]}>{L.priority[incident.priority]} priority</StatusBadge>
        <StatusBadge tone={tone.incident[incident.status]}>{L.incidentStatus[incident.status]}</StatusBadge>
        {incident.source === "citizen_sos" && <StatusBadge tone="info" icon={false}>Citizen SOS (demo)</StatusBadge>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-2 flex gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><div><dt className="sr-only">Location</dt><dd>{incident.location.area}, {incident.location.district}<span className="block text-xs text-muted-foreground">{incident.location.coordinates[1].toFixed(4)}° N, {incident.location.coordinates[0].toFixed(4)}° E</span></dd></div></div>
        <div className="flex gap-2"><Users className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">People affected</dt><dd className="font-semibold">{incident.peopleAffected}</dd></div></div>
        <div className="flex gap-2"><HeartPulse className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">Medical help</dt><dd className="font-semibold">{incident.medicalNeeded ? "Needed" : "Not reported"}</dd></div></div>
        <div className="flex gap-2"><Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">Reported</dt><dd>{formatDateTime(incident.reportedAt)}</dd></div></div>
        <div className="flex gap-2"><Phone className="mt-0.5 size-4 text-muted-foreground" aria-hidden /><div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{incident.contact ?? "Not given"}</dd></div></div>
        <div className="col-span-2"><dt className="text-xs text-muted-foreground">Type</dt><dd className="font-medium">{L.incidentType[incident.type]}</dd></div>
        {incident.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Notes</dt><dd>{incident.notes}</dd></div>}
      </dl>

      <div className="space-y-1.5">
        <Label htmlFor={`prio-${incident.id}`}>Priority</Label>
        <Select value={incident.priority} onValueChange={(v) => { updatePriority(incident.id, v as Priority); toast.success(`${incident.id} priority set to ${L.priority[v as Priority]}`); }}>
          <SelectTrigger id={`prio-${incident.id}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{L.priority[p]}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Initial priority comes from a simple demo rule (medical need, people count). Operators can override it.</p>
      </div>

      <section aria-labelledby={`assign-${incident.id}`} className="space-y-2 rounded-lg border bg-muted/40 p-3">
        <h3 id={`assign-${incident.id}`} className="text-sm font-semibold">Response team</h3>
        {team ? (
          <p className="text-sm">
            <b>{team.name}</b> ({team.kind}, {team.members} people) · lead {team.lead.name}
            {mission && <span className="block text-muted-foreground">Mission {mission.id}: {L.missionStatus[mission.status]} · approach {formatKm(missionLeg(team, incident).distanceM)}{missionLeg(team, incident).onRoad ? " by road" : " straight-line"}</span>}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No team assigned.</p>
        )}
        {!resolved && (
          <div className="flex gap-2">
            <Select value={teamId} onValueChange={setTeamId}>
              <SelectTrigger className="min-w-0 flex-1 bg-card" aria-label={team ? "Choose a team to reassign" : "Choose a team to assign"}>
                <SelectValue placeholder={team ? "Reassign to…" : "Choose team…"} />
              </SelectTrigger>
              <SelectContent>
                {teams.filter((t) => t.id !== team?.id).map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={t.availability === "off_duty"}>
                    {t.name} · {t.availability === "available" ? "Available" : t.availability === "on_mission" ? "On a mission" : "Off duty"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button disabled={!candidate} onClick={() => (team || candidate?.availability === "on_mission" ? setConfirm("reassign") : assign())}>
              {team ? "Reassign" : "Assign"}
            </Button>
          </div>
        )}
      </section>

      {!resolved && (
        <div className="flex flex-wrap gap-2">
          {mission && nextStep && nextStep !== "completed" && (
            <Button variant="secondary" onClick={async () => { await api.updateMissionStatus(mission.id, nextStep); toast.success(`${incident.id}: ${L.missionStatus[nextStep]}`); }}>
              Mark {L.missionStatus[nextStep].toLowerCase()}
            </Button>
          )}
          <Button variant="outline" onClick={() => setConfirm("resolve")}>Mark resolved</Button>
        </div>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "resolve" ? `Resolve ${incident.id}?` : `Assign ${candidate?.name} to ${incident.id}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "resolve"
                ? "The incident closes and any active mission is marked completed, freeing its team."
                : `${team ? `${team.name} will be released from this incident. ` : ""}${candidate?.availability === "on_mission" ? `${candidate.name} is already on another mission and will be stretched across both.` : ""}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (confirm === "resolve") {
                  await api.updateIncidentStatus(incident.id, "resolved");
                  toast.success(`${incident.id} resolved`);
                } else await assign();
              }}
            >
              {confirm === "resolve" ? "Resolve incident" : "Assign team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
