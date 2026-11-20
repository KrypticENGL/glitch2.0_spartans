import { Clock, Route as RouteIcon } from "lucide-react";
import type { EvacuationRoute } from "@/types";
import { L, formatKm, formatMin, tone } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { cn } from "@/lib/utils";

const LINE_SAMPLE: Record<EvacuationRoute["classification"], string> = {
  recommended: "border-t-[4px] border-solid border-ok",
  alternative: "border-t-[3px] border-solid border-info",
  caution: "border-t-[3px] border-dashed border-warn",
  unavailable: "border-t-[3px] border-dotted border-danger",
};

/** Legend swatch that mirrors the map line pattern (so routes are distinguishable without colour). */
export function RouteSwatch({ c }: { c: EvacuationRoute["classification"] }) {
  return <span aria-hidden className={cn("inline-block w-7", LINE_SAMPLE[c])} />;
}

export function RouteCard({ route, selected, onSelect, compact }: { route: EvacuationRoute; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const segs = ROAD_SEGMENTS.filter((s) => route.affectedSegmentIds.includes(s.id));
  const prominent = route.classification === "recommended";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border bg-card p-3 text-left transition-[border-color,box-shadow]",
        prominent && "border-ok/40",
        selected && "border-teal shadow-[0_0_0_1px_var(--teal)]",
        route.classification === "unavailable" && !selected && "bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <RouteSwatch c={route.classification} />
          {route.label}
        </span>
        <StatusBadge tone={tone.route[route.classification]}>{L.route[route.classification]}</StatusBadge>
      </div>
      <div className="mt-2 flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          <span className={cn("font-semibold", route.classification === "unavailable" && "line-through decoration-danger/60")}>{formatMin(route.durationS)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <RouteIcon className="size-4 text-muted-foreground" aria-hidden />
          {formatKm(route.distanceM)}
        </span>
        <span className="text-xs text-muted-foreground">by vehicle, normal conditions</span>
      </div>
      {!compact && (
        <>
          <p className="mt-2 text-sm leading-snug text-muted-foreground">{route.rationale}</p>
          {segs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {segs.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <StatusBadge tone={tone.road[s.condition]} className="h-5">{L.road[s.condition]}</StatusBadge>
                  <span>{s.name}{s.verified ? "" : " (unverified report)"}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </button>
  );
}
