"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { CheckCircle2, LifeBuoy, Phone } from "lucide-react";
import { toast } from "sonner";
import type { Incident, IncidentType } from "@/types";
import { api } from "@/services/api";
import { LOCALITIES } from "@/data/mock/seed";
import { DEMO_REGION } from "@/config/geo";
import { L, formatTime } from "@/lib/format";
import { validateSOS, type Errors, type SOSForm } from "@/features/incidents/validation";
import { Field, describedBy } from "@/components/shared/field";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { tone } from "@/lib/format";

const TYPES = Object.keys(L.incidentType) as IncidentType[];
const EMPTY: SOSForm = { area: "Darbhanga Town", type: "", people: "1", medical: false, notes: "", contact: "" };

export function SOSFormView() {
  const [form, setForm] = useState<SOSForm>(EMPTY);
  const [errors, setErrors] = useState<Errors<SOSForm>>({});
  const [confirming, setConfirming] = useState(false);
  const [created, setCreated] = useState<Incident | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof SOSForm>(k: K, v: SOSForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validateSOS(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setConfirming(true);
  }

  async function confirm() {
    const loc = LOCALITIES.find((l) => l.area === form.area)!;
    const inc = await api.submitSOS({
      location: { coordinates: loc.coordinates, area: loc.area, district: DEMO_REGION.district },
      type: form.type as IncidentType,
      peopleAffected: Number(form.people),
      medicalNeeded: form.medical,
      notes: form.notes.trim(),
      contact: form.contact.trim() || undefined,
    });
    setCreated(inc);
    setForm(EMPTY);
    toast.success(`Demo request ${inc.id} created`, { description: "It now appears in the operations incident queue." });
  }

  if (created) {
    return (
      <div role="status" className="space-y-4 rounded-xl border bg-card p-5">
        <CheckCircle2 className="size-8 text-ok" aria-hidden />
        <div>
          <h2 className="text-xl font-bold">Demo request {created.id} created</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Recorded at {formatTime(created.reportedAt)} for {created.location.area}. This did <b>not</b> contact any emergency service.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={tone.priority[created.priority]}>Priority: {L.priority[created.priority]}</StatusBadge>
          <StatusBadge tone="danger">{L.incidentStatus[created.status]}</StatusBadge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/dashboard/incidents">See it in the operations queue</Link></Button>
          <Button variant="outline" onClick={() => setCreated(null)}>Create another request</Button>
          <Button asChild variant="ghost"><Link href="/shelters">Find a shelter</Link></Button>
        </div>
      </div>
    );
  }

  const errList = Object.values(errors);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-xl border bg-card p-5">
      {errList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm">
          <p className="font-semibold">Fix {errList.length === 1 ? "this" : `these ${errList.length}`} before sending:</p>
          <ul className="mt-1 list-disc pl-5">{errList.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}

      <Field id="sos-area" label="Where is help needed?" hint="Your demo location is Darbhanga Town." error={errors.area}>
        <Select value={form.area} onValueChange={(v) => set("area", v)}>
          <SelectTrigger id="sos-area" className="h-11 w-full" aria-invalid={!!errors.area} aria-describedby={describedBy("sos-area", errors.area, "x")}>
            <SelectValue placeholder="Choose locality" />
          </SelectTrigger>
          <SelectContent>
            {LOCALITIES.map((l) => <SelectItem key={l.area} value={l.area}>{l.area}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <fieldset className="space-y-2" aria-describedby={errors.type ? "sos-type-error" : undefined}>
        <legend className="text-sm font-semibold">What kind of emergency?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <label key={t} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-danger has-checked:bg-danger/5 has-checked:font-semibold has-focus-visible:ring-2 has-focus-visible:ring-ring">
              <input type="radio" name="sos-type" value={t} checked={form.type === t} onChange={() => set("type", t)} className="accent-[#c8322b]" />
              {L.incidentType[t]}
            </label>
          ))}
        </div>
        {errors.type && <p id="sos-type-error" className="text-sm font-medium text-[#a3241e]">{errors.type}</p>}
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="sos-people" label="People needing help" error={errors.people}>
          <Input id="sos-people" inputMode="numeric" className="h-11" value={form.people} onChange={(e) => set("people", e.target.value)} aria-invalid={!!errors.people} aria-describedby={describedBy("sos-people", errors.people)} />
        </Field>
        <div className="flex items-end">
          <label htmlFor="sos-medical" className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md border px-3 text-sm font-medium">
            <Checkbox id="sos-medical" checked={form.medical} onCheckedChange={(v) => set("medical", v === true)} />
            Someone needs medical help
          </label>
        </div>
      </div>

      <Field id="sos-notes" label="Anything rescuers should know" optional hint="Landmarks, water level, children or elderly people present." error={errors.notes}>
        <Textarea id="sos-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} aria-invalid={!!errors.notes} aria-describedby={describedBy("sos-notes", errors.notes, "x")} />
      </Field>

      <Field id="sos-contact" label="Mobile number" optional hint="Used only inside this demo." error={errors.contact}>
        <Input id="sos-contact" type="tel" autoComplete="tel" className="h-11" value={form.contact} onChange={(e) => set("contact", e.target.value)} aria-invalid={!!errors.contact} aria-describedby={describedBy("sos-contact", errors.contact, "x")} />
      </Field>

      <Button type="submit" size="lg" className="h-12 w-full bg-danger text-base text-white hover:bg-danger/90">
        <LifeBuoy /> Send demo rescue request
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a demonstration request?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds an incident to the demo operations queue on this device only. No emergency service will be contacted. In a real emergency, call 112.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-start"><DemoBadge /></div>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Create demo request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

export function RealEmergencyNote() {
  return (
    <p className="flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 text-sm">
      <Phone className="size-4 shrink-0 text-danger" aria-hidden />
      <span>Real emergency in India? Call <b>112</b>. This form is a demonstration and sends nothing.</span>
    </p>
  );
}
