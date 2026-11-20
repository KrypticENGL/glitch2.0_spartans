"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { IncidentStatus, Priority } from "@/types";
import { useDemoStore } from "@/store/demo-store";
import { L, formatDateTime, tone } from "@/lib/format";
import { PRIORITY_RANK } from "@/features/incidents/sort";
import { IncidentSheet } from "@/components/incidents/incident-sheet";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PRIORITIES = Object.keys(L.priority) as Priority[];
const STATUSES = Object.keys(L.incidentStatus) as IncidentStatus[];

export function IncidentQueue() {
  const incidents = useDemoStore((s) => s.incidents);
  const teams = useDemoStore((s) => s.teams);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [status, setStatus] = useState<IncidentStatus | "open" | "all">("open");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents
      .filter((i) => priority === "all" || i.priority === priority)
      .filter((i) => status === "all" || (status === "open" ? i.status !== "resolved" : i.status === status))
      .filter((i) => !q || `${i.id} ${i.location.area} ${L.incidentType[i.type]} ${i.notes}`.toLowerCase().includes(q))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, query, priority, status]);

  const filtered = query || priority !== "all" || status !== "open";

  return (
    <div className="space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by ID, area, type or notes" aria-label="Search incidents" className="bg-card pl-9" />
        </div>
        <Select value={priority} onValueChange={(v) => setPriority(v as Priority | "all")}>
          <SelectTrigger className="w-40 bg-card" aria-label="Filter by priority"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{L.priority[p]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as IncidentStatus | "open" | "all")}>
          <SelectTrigger className="w-40 bg-card" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">All open</SelectItem>
            <SelectItem value="all">Everything</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{L.incidentStatus[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <DemoBadge label="Simulated incidents" />
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">{rows.length} incidents · sorted by priority, then newest</p>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Incident</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Reported</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center">
                  <p className="font-medium">No incidents match.</p>
                  {filtered && <Button variant="link" onClick={() => { setQuery(""); setPriority("all"); setStatus("open"); }}>Clear filters</Button>}
                </TableCell>
              </TableRow>
            )}
            {rows.map((i) => (
              <TableRow key={i.id} className="cursor-pointer" onClick={() => setOpenId(i.id)}>
                <TableCell>
                  <button type="button" className="text-left font-semibold" onClick={(e) => { e.stopPropagation(); setOpenId(i.id); }}>
                    {i.id}
                  </button>
                  <span className="block text-xs text-muted-foreground">{L.incidentType[i.type]}{i.source === "citizen_sos" ? " · citizen SOS" : ""}{i.medicalNeeded ? " · medical" : ""}</span>
                </TableCell>
                <TableCell>{i.location.area}</TableCell>
                <TableCell><StatusBadge tone={tone.priority[i.priority]}>{L.priority[i.priority]}</StatusBadge></TableCell>
                <TableCell><StatusBadge tone={tone.incident[i.status]}>{L.incidentStatus[i.status]}</StatusBadge></TableCell>
                <TableCell className="text-right font-semibold">{i.peopleAffected}</TableCell>
                <TableCell>{teams.find((t) => t.id === i.assignedTeamId)?.name ?? <span className="text-[#a3241e]">Unassigned</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(i.reportedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <IncidentSheet incidentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
