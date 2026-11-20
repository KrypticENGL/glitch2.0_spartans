import { CheckCircle2, CircleDashed, FlaskConical, Info, OctagonX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok/10 text-[#1f6b39] border-ok/30",
  warn: "bg-warn/12 text-[#8a5806] border-warn/35",
  danger: "bg-danger/10 text-[#a3241e] border-danger/30",
  info: "bg-info/10 text-[#0a6567] border-info/30",
  muted: "bg-muted text-muted-foreground border-border",
};
const TONE_ICON = { ok: CheckCircle2, warn: TriangleAlert, danger: OctagonX, info: Info, muted: CircleDashed };

/** Status chip: icon shape + text, so meaning never depends on colour alone. */
export function StatusBadge({ tone, children, className, icon = true }: { tone: Tone; children: ReactNode; className?: string; icon?: boolean }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-xs font-semibold whitespace-nowrap", TONE_CLASS[tone], className)}>
      {icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export const toneText: Record<Tone, string> = {
  ok: "text-[#1f6b39]",
  warn: "text-[#8a5806]",
  danger: "text-[#a3241e]",
  info: "text-[#0a6567]",
  muted: "text-muted-foreground",
};
export const toneBar: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info", muted: "bg-muted-tone" };

export function DemoBadge({ className, label = "Demonstration data" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border border-dashed border-[#8a5806]/50 bg-[#fff7e6] px-2 text-xs font-semibold text-[#7a4f08]",
        className,
      )}
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** Thin capacity meter with an accessible value. */
export function Meter({ value, tone, label, className }: { value: number; tone: Tone; label: string; className?: string }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full", toneBar[tone])} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}
