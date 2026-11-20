"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { toast } from "sonner";
import type { Shelter, ShelterStatus } from "@/types";
import { useDemoStore } from "@/store/demo-store";
import { L, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { MapView } from "@/components/maps/map-view";
import { nextFocus, type CameraFocus } from "@/components/maps/map-types";
import { DemoBadge, Meter, StatusBadge } from "@/components/shared/status";
import { FacilityIcons } from "@/components/shelters/shelter-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SortKey = "name" | "occupancy" | "spaces" | "status";
const STATUSES = Object.keys(L.shelterStatus) as ShelterStatus[];
const STATUS_ORDER: Record<ShelterStatus, number> = { full: 0, near_capacity: 1, open: 2, closed: 3 };

function EditSheet({ shelter, onClose }: { shelter: Shelter | undefined; onClose: () => void }) {
  const update = useDemoStore((s) => s.updateShelter);
  return (
    <Sheet open={!!shelter} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        {shelter && <EditForm key={shelter.id} shelter={shelter} onSave={(p) => { update(shelter.id, p); toast.success(`${shelter.name} updated`, { description: "Saved to local demo state." }); onClose(); }} />}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({ shelter, onSave }: { shelter: Shelter; onSave: (p: { occupancy: number; capacity: number; status: ShelterStatus }) => void }) {
  const [occupancy, setOccupancy] = useState(String(shelter.occupancy));
  const [capacity, setCapacity] = useState(String(shelter.capacity));
  const [status, setStatus] = useState<ShelterStatus>(shelter.status);
  const cap = Number(capacity);
  const occ = Number(occupancy);
  const error =
    !Number.isInteger(cap) || cap < 1 || cap > 10000 ? "Capacity must be a whole number between 1 and 10,000."
    : !Number.isInteger(occ) || occ < 0 ? "Occupancy must be a whole number of 0 or more."
    : occ > cap ? "Occupancy cannot exceed capacity."
    : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!error) onSave({ occupancy: occ, capacity: cap, status });
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <SheetHeader className="border-b">
        <SheetTitle>{shelter.name}</SheetTitle>
        <SheetDescription>Edits update the citizen shelter finder and dashboard immediately. They are stored only in this browser.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ed-occ">People sheltered</Label>
            <Input id="ed-occ" inputMode="numeric" value={occupancy} onChange={(e) => setOccupancy(e.target.value)} aria-invalid={!!error} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-cap">Capacity</Label>
            <Input id="ed-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} aria-invalid={!!error} />
          </div>
        </div>
        {error ? <p role="alert" className="text-sm font-medium text-[#a3241e]">{error}</p> : <Meter value={Math.round((occ / cap) * 100)} tone={tone.shelter[status]} label="Occupancy preview" />}
        <div className="space-y-1.5">
          <Label htmlFor="ed-status">Operational status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ShelterStatus)}>
            <SelectTrigger id="ed-status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{L.shelterStatus[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">Facilities</p>
          <FacilityIcons facilities={shelter.facilities} />
          <p className="text-muted-foreground">{shelter.accessibilityNotes}</p>
        </div>
      </div>
      <SheetFooter className="border-t">
        <Button type="submit" disabled={!!error}>Save changes</Button>
      </SheetFooter>
    </form>
  );
}

type Sort = { key: SortKey; dir: 1 | -1 };

function SortHead({ k, sort, onSort, children, className }: { k: SortKey; sort: Sort; onSort: (s: Sort) => void; children: string; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 font-semibold" onClick={() => onSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === "name" ? 1 : -1 })}>
        {children} <Icon className={cn("size-3.5", !active && "opacity-40")} aria-hidden />
      </button>
    </TableHead>
  );
}

export function ShelterManagement() {
  const shelters = useDemoStore((s) => s.shelters);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ShelterStatus | "all">("all");
  const [sort, setSort] = useState<Sort>({ key: "occupancy", dir: -1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [focus, setFocus] = useState<CameraFocus | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const val = (s: Shelter) => (sort.key === "name" ? s.name : sort.key === "occupancy" ? occupancyPct(s) : sort.key === "spaces" ? spacesLeft(s) : STATUS_ORDER[s.status]);
    return shelters
      .filter((s) => (status === "all" || s.status === status) && (!q || `${s.name} ${s.location.area}`.toLowerCase().includes(q)))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [shelters, query, status, sort]);

  function pick(s: Shelter) {
    setSelectedId(s.id);
    setFocus((f) => nextFocus(f, { center: s.location.coordinates, zoom: 15 }));
  }

  return (
    <div className="grid gap-4 p-3 md:p-4 2xl:grid-cols-[1fr_520px]">
      <section aria-label="Shelter table" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shelters or areas" aria-label="Search shelters" className="bg-card pl-9" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as ShelterStatus | "all")}>
            <SelectTrigger className="w-44 bg-card" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{L.shelterStatus[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <DemoBadge label="Edits are local demo state" />
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="name" sort={sort} onSort={setSort}>Shelter</SortHead>
                <SortHead k="status" sort={sort} onSort={setSort}>Status</SortHead>
                <SortHead k="occupancy" sort={sort} onSort={setSort} className="w-56">Occupancy</SortHead>
                <SortHead k="spaces" sort={sort} onSort={setSort} className="text-right">Spaces free</SortHead>
                <TableHead className="hidden lg:table-cell">Facilities</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No shelters match these filters.</TableCell></TableRow>
              )}
              {rows.map((s) => (
                <TableRow key={s.id} data-state={s.id === selectedId ? "selected" : undefined} className="cursor-pointer data-[state=selected]:bg-accent/60" onClick={() => pick(s)}>
                  <TableCell>
                    <button type="button" className="text-left font-medium" onClick={(e) => { e.stopPropagation(); pick(s); }}>{s.name}</button>
                    <span className="block text-xs text-muted-foreground">{s.location.area} · {s.kind}</span>
                  </TableCell>
                  <TableCell><StatusBadge tone={tone.shelter[s.status]}>{L.shelterStatus[s.status]}</StatusBadge></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Meter value={occupancyPct(s)} tone={tone.shelter[s.status]} label={`${s.name} occupancy`} />
                      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{s.occupancy}/{s.capacity}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{s.status === "closed" ? "—" : spacesLeft(s)}</TableCell>
                  <TableCell className="hidden lg:table-cell"><FacilityIcons facilities={s.facilities} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditId(s.id); }}>Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section aria-label="Shelter map" className="relative h-[420px] overflow-hidden rounded-lg border 2xl:sticky 2xl:top-18 2xl:h-[calc(100dvh-6rem)]">
        <MapView
          label="Map of shelters"
          shelters={rows}
          selection={selectedId ? { kind: "shelter", id: selectedId } : null}
          onSelect={(sel) => { if (sel.kind === "shelter") setSelectedId(sel.id); }}
          focus={focus}
        />
      </section>
      <EditSheet shelter={shelters.find((s) => s.id === editId)} onClose={() => setEditId(null)} />
    </div>
  );
}
