"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { toast } from "sonner";
import type { Priority } from "@/types";
import { useDemoStore } from "@/store/demo-store";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { L, formatTime, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { missionLeg } from "@/features/rescue/mission-route";
import { MapView } from "@/components/maps/map-view";
import { MapPanel, sheetPx, type SheetSize } from "@/components/maps/map-panel";
import { nextFocus, type CameraFocus, type MapLayerKey, type MapSelection, type MapRoute } from "@/components/maps/map-types";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { Meter, StatusBadge } from "@/components/shared/status";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const LAYERS: { key: MapLayerKey; label: string }[] = [
  { key: "incidents", label: "Incidents" },
  { key: "shelters", label: "Shelters" },
  { key: "teams", label: "Rescue teams" },
  { key: "roads", label: "Road conditions" },
  { key: "hazards", label: "Citizen hazard reports" },
  { key: "routes", label: "Mission approach routes" },
];
const PRIORITIES = Object.keys(L.priority) as Priority[];

export function OperationsMap() {
  const { shelters, incidents, teams, hazards, missions, reviewHazard } = useDemoStore();
  const [visible, setVisible] = useState<Record<MapLayerKey, boolean>>({ incidents: true, shelters: true, teams: true, roads: true, hazards: true, routes: true });
  const [priorities, setPriorities] = useState<Set<Priority>>(new Set(PRIORITIES));
  const [showResolved, setShowResolved] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const [sheet, setSheet] = useState<SheetSize>("peek");
  const isMobile = useIsMobile();

  const shownIncidents = incidents.filter((i) => priorities.has(i.priority) && (showResolved || i.status !== "resolved"));
  const legs: MapRoute[] = useMemo(
    () =>
      missions
        .filter((m) => m.status !== "completed")
        .flatMap((m) => {
          const t = teams.find((x) => x.id === m.teamId);
          const i = incidents.find((x) => x.id === m.incidentId);
          return t && i ? [missionLeg(t, i).route] : [];
        }),
    [missions, teams, incidents],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return [
      ...incidents.filter((i) => `${i.id} ${i.location.area} ${L.incidentType[i.type]}`.toLowerCase().includes(q)).map((i) => ({ kind: "incident" as const, id: i.id, title: `${i.id} · ${L.incidentType[i.type]}`, sub: i.location.area, at: i.location.coordinates })),
      ...shelters.filter((s) => `${s.name} ${s.location.area}`.toLowerCase().includes(q)).map((s) => ({ kind: "shelter" as const, id: s.id, title: s.name, sub: `Shelter · ${s.location.area}`, at: s.location.coordinates })),
      ...teams.filter((t) => `${t.name} ${t.kind} ${t.base.area}`.toLowerCase().includes(q)).map((t) => ({ kind: "team" as const, id: t.id, title: t.name, sub: `Team base · ${t.base.area}`, at: t.base.coordinates })),
    ].slice(0, 8);
  }, [query, incidents, shelters, teams]);

  function select(sel: MapSelection, fly?: [number, number]) {
    setSelection(sel);
    if (isMobile) setSheet("half");
    if (fly) setFocus((f) => nextFocus(f, { center: fly }));
  }

  const padding = isMobile ? { top: 60, right: 60, bottom: sheetPx(sheet) + 20, left: 30 } : { top: 60, right: 70, bottom: 60, left: 440 };
  const sel = selection;
  const incident = sel?.kind === "incident" ? incidents.find((i) => i.id === sel.id) : undefined;
  const shelter = sel?.kind === "shelter" ? shelters.find((s) => s.id === sel.id) : undefined;
  const team = sel?.kind === "team" ? teams.find((t) => t.id === sel.id) : undefined;
  const hazard = sel?.kind === "hazard" ? hazards.find((h) => h.id === sel.id) : undefined;

  const header = (
    <div className="space-y-2 pt-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search incidents, shelters, teams, areas" aria-label="Search the map" className="h-10 bg-card pl-9" />
      </div>
      {results.length > 0 && (
        <ul className="max-h-60 overflow-y-auto rounded-md border bg-card" aria-label="Search results">
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { select({ kind: r.kind, id: r.id }, r.at); setQuery(""); }}>
                <span className="block font-medium">{r.title}</span>
                <span className="block text-xs text-muted-foreground">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-3.5rem)]">
      <MapView
        label="Operations map"
        shelters={shelters}
        incidents={shownIncidents}
        teams={teams}
        hazards={hazards}
        roads={ROAD_SEGMENTS}
        routes={legs}
        visible={visible}
        selection={selection}
        onSelect={(s) => select(s)}
        focus={focus}
        padding={padding}
      />
      <MapPanel title="Operations map controls and details" header={header} size={sheet} onSizeChange={setSheet}>
        {sel ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setSelection(null)}><ChevronLeft /> Layers and filters</Button>
            {incident && (<><h2 className="text-lg font-bold">{incident.id} · {L.incidentType[incident.type]}</h2><IncidentDetail incident={incident} /></>)}
            {shelter && (
              <div className="space-y-3">
                <h2 className="text-lg font-bold">{shelter.name}</h2>
                <StatusBadge tone={tone.shelter[shelter.status]}>{L.shelterStatus[shelter.status]}</StatusBadge>
                <p className="text-sm">{spacesLeft(shelter)} spaces free of {shelter.capacity} ({occupancyPct(shelter)}% full)</p>
                <Meter value={occupancyPct(shelter)} tone={tone.shelter[shelter.status]} label="Occupancy" />
                <p className="text-sm text-muted-foreground">{shelter.accessibilityNotes}</p>
                <Button asChild variant="outline" size="sm"><Link href="/dashboard/shelters">Edit in shelter management</Link></Button>
              </div>
            )}
            {team && (
              <div className="space-y-2 text-sm">
                <h2 className="text-lg font-bold">{team.name}</h2>
                <p>{team.kind} · {team.members} people · base {team.base.area}</p>
                <p>Lead: {team.lead.name}, {team.lead.phone}</p>
                <p className="text-muted-foreground">Equipment: {team.equipment.join(", ")}</p>
                <p className="text-xs text-muted-foreground">Shown at base location. Live responder tracking is not simulated.</p>
              </div>
            )}
            {hazard && (
              <div className="space-y-3 text-sm">
                <h2 className="text-lg font-bold">{L.hazard[hazard.type]} · {hazard.location.area}</h2>
                <StatusBadge tone={hazard.review === "verified" ? "ok" : hazard.review === "unverified" ? "warn" : "muted"}>{hazard.review === "verified" ? "Verified" : hazard.review === "unverified" ? "Unverified citizen report" : "Dismissed"}</StatusBadge>
                <p>{hazard.description}</p>
                <p className="text-xs text-muted-foreground">Severity {hazard.severity} · {formatTime(hazard.reportedAt)}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={hazard.review === "verified"} onClick={() => { reviewHazard(hazard.id, "verified"); toast.success(`${hazard.id} marked verified`); }}>Mark verified</Button>
                  <Button size="sm" variant="outline" disabled={hazard.review === "dismissed"} onClick={() => { reviewHazard(hazard.id, "dismissed"); setSelection(null); toast.success(`${hazard.id} dismissed`); }}>Dismiss</Button>
                </div>
                <p className="text-xs text-muted-foreground">Verifying a report does not change routing; road closures are managed separately.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <fieldset className="space-y-2.5">
              <legend className="mb-1 text-sm font-semibold">Layers</legend>
              {LAYERS.map((l) => (
                <div key={l.key} className="flex items-center justify-between">
                  <Label htmlFor={`layer-${l.key}`} className="font-normal">{l.label}</Label>
                  <Switch id={`layer-${l.key}`} checked={visible[l.key]} onCheckedChange={(v) => setVisible((s) => ({ ...s, [l.key]: v }))} />
                </div>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Incident priority</legend>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => {
                  const on = priorities.has(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPriorities((s) => { const n = new Set(s); if (on) n.delete(p); else n.add(p); return n; })}
                      className={cn("h-8 rounded-full border px-3 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}
                    >
                      {L.priority[p]}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-1">
                <Label htmlFor="show-resolved" className="font-normal">Show resolved incidents</Label>
                <Switch id="show-resolved" checked={showResolved} onCheckedChange={setShowResolved} />
              </div>
            </fieldset>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Showing {shownIncidents.length} incidents</p>
              <ul className="divide-y rounded-md border bg-card">
                {shownIncidents.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => select({ kind: "incident", id: i.id }, i.location.coordinates)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted">
                      <span><b>{i.id}</b> · {i.location.area}</span>
                      <StatusBadge tone={tone.priority[i.priority]}>{L.priority[i.priority]}</StatusBadge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">Dashed approach lines are straight-line bearings for new assignments; solid ones follow OSM roads (illustrative). Hollow amber dots are unverified citizen reports.</p>
          </div>
        )}
      </MapPanel>
    </div>
  );
}
