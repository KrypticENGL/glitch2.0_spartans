"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { HazardSeverity, HazardType } from "@/types";
import { api } from "@/services/api";
import { useDemoStore } from "@/store/demo-store";
import { LOCALITIES } from "@/data/mock/seed";
import { DEMO_REGION } from "@/config/geo";
import { L, formatTime } from "@/lib/format";
import { validateHazard, type Errors, type HazardForm } from "@/features/incidents/validation";
import { Field, describedBy } from "@/components/shared/field";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TYPES = Object.keys(L.hazard) as HazardType[];
const SEVERITIES: { id: HazardSeverity; label: string; hint: string }[] = [
  { id: "low", label: "Low", hint: "Passable with care" },
  { id: "moderate", label: "Moderate", hint: "Slows traffic" },
  { id: "severe", label: "Severe", hint: "Not passable" },
];
const EMPTY: HazardForm = { area: "", type: "", severity: "", description: "" };
const REVIEW_TONE = { unverified: "warn", verified: "ok", dismissed: "muted" } as const;
const REVIEW_LABEL = { unverified: "Unverified", verified: "Verified by operator", dismissed: "Dismissed" } as const;

export function HazardFormView() {
  const [form, setForm] = useState<HazardForm>(EMPTY);
  const [errors, setErrors] = useState<Errors<HazardForm>>({});
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  const hazards = useDemoStore((s) => s.hazards);
  const set = <K extends keyof HazardForm>(k: K, v: HazardForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function choosePhoto(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewRef.current);
  }
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validateHazard(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const loc = LOCALITIES.find((l) => l.area === form.area)!;
    const report = await api.submitHazardReport({
      location: { coordinates: loc.coordinates, area: loc.area, district: DEMO_REGION.district },
      type: form.type as HazardType,
      severity: form.severity as HazardSeverity,
      description: form.description.trim(),
      imageName: file?.name, // shortcut: the image stays on this device; only its name is kept in demo state
    });
    toast.success(`Report ${report.id} submitted`, { description: "Marked unverified until an operator reviews it. Road status is unchanged." });
    setForm(EMPTY);
    choosePhoto(null);
  }

  const mine = hazards.filter((h) => h.id.startsWith("HZ-C"));

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-xl border bg-card p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="hz-area" label="Location" error={errors.area}>
            <Select value={form.area} onValueChange={(v) => set("area", v)}>
              <SelectTrigger id="hz-area" className="h-11 w-full" aria-invalid={!!errors.area} aria-describedby={describedBy("hz-area", errors.area)}>
                <SelectValue placeholder="Choose locality" />
              </SelectTrigger>
              <SelectContent>{LOCALITIES.map((l) => <SelectItem key={l.area} value={l.area}>{l.area}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="hz-type" label="Hazard type" error={errors.type}>
            <Select value={form.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger id="hz-type" className="h-11 w-full" aria-invalid={!!errors.type} aria-describedby={describedBy("hz-type", errors.type)}>
                <SelectValue placeholder="Choose type" />
              </SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{L.hazard[t]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Severity</legend>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITIES.map((s) => (
              <label key={s.id} className="flex min-h-14 cursor-pointer flex-col justify-center rounded-md border px-3 py-2 text-sm has-checked:border-warn has-checked:bg-warn/10 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <span className="flex items-center gap-2 font-semibold">
                  <input type="radio" name="hz-sev" value={s.id} checked={form.severity === s.id} onChange={() => set("severity", s.id)} className="accent-[#c27c0e]" />
                  {s.label}
                </span>
                <span className="text-xs text-muted-foreground">{s.hint}</span>
              </label>
            ))}
          </div>
          {errors.severity && <p className="text-sm font-medium text-[#a3241e]">{errors.severity}</p>}
        </fieldset>

        <Field id="hz-desc" label="What did you see?" error={errors.description}>
          <Textarea id="hz-desc" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} aria-invalid={!!errors.description} aria-describedby={describedBy("hz-desc", errors.description)} />
        </Field>

        <div className="space-y-2">
          <span className="text-sm font-semibold">Photo <span className="font-normal text-muted-foreground">(optional, stays on this device)</span></span>
          {preview ? (
            <div className="relative w-fit">
              <Image src={preview} alt="Selected hazard photo preview" width={240} height={160} unoptimized className="h-40 w-60 rounded-md border object-cover" />
              <button type="button" onClick={() => choosePhoto(null)} aria-label="Remove photo" className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-card shadow">
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring">
              <ImagePlus className="size-5" aria-hidden /> Choose a photo
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <Button type="submit" size="lg" className="h-12 w-full text-base"><Send /> Submit report</Button>
      </form>

      <section aria-labelledby="mine-h" className="space-y-2">
        <h2 id="mine-h" className="text-lg font-bold">Your reports</h2>
        {mine.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Reports you submit appear here with their review status.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {mine.map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                <span>
                  <span className="block font-semibold">{L.hazard[h.type]} · {h.location.area}</span>
                  <span className="block text-muted-foreground">{h.description}</span>
                  <span className="block text-xs text-muted-foreground">{h.id} · {formatTime(h.reportedAt)}{h.imageName ? ` · photo: ${h.imageName}` : ""}</span>
                </span>
                <StatusBadge tone={REVIEW_TONE[h.review]}>{REVIEW_LABEL[h.review]}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
