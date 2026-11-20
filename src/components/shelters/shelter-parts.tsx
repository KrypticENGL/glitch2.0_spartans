import { Accessibility, Droplet, Stethoscope, Toilet, Utensils, Zap, type LucideIcon } from "lucide-react";
import type { Shelter, ShelterFacility } from "@/types";
import { L, formatKm, occupancyPct, spacesLeft, tone } from "@/lib/format";
import { Meter, StatusBadge } from "@/components/shared/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const FACILITY_ICON: Record<ShelterFacility, LucideIcon> = {
  water: Droplet,
  medical: Stethoscope,
  food: Utensils,
  power: Zap,
  accessible: Accessibility,
  sanitation: Toilet,
};

export function FacilityIcons({ facilities, className }: { facilities: ShelterFacility[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Facilities">
      {facilities.map((f) => {
        const Icon = FACILITY_ICON[f];
        return (
          <li key={f}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="grid size-7 place-items-center rounded-sm bg-secondary text-primary" tabIndex={-1}>
                  <Icon className="size-3.5" aria-hidden />
                  <span className="sr-only">{L.facility[f]}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>{L.facility[f]}</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

export function OccupancyLine({ shelter }: { shelter: Shelter }) {
  const pct = occupancyPct(shelter);
  const t = tone.shelter[shelter.status];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="text-lg font-bold text-foreground">{shelter.status === "closed" ? "—" : spacesLeft(shelter)}</span>
          <span className="text-muted-foreground"> spaces left of {shelter.capacity}</span>
        </span>
        <span className="text-xs font-semibold text-muted-foreground">{pct}% full</span>
      </div>
      <Meter value={pct} tone={t} label={`${shelter.name} occupancy`} />
    </div>
  );
}

interface CardProps {
  shelter: Shelter;
  distanceM?: number;
  selected: boolean;
  onSelect: () => void;
}

export function ShelterCard({ shelter, distanceM, selected, onSelect }: CardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-shelter-id={shelter.id}
      className={cn(
        "group relative w-full border-b bg-card px-1 py-3.5 text-left transition-colors hover:bg-muted/35",
        selected && "bg-[#f1f7f5] before:absolute before:inset-y-2 before:left-[-1rem] before:w-[3px] before:bg-teal",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{shelter.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {shelter.location.area} · {formatKm(distanceM)} by road
          </p>
        </div>
        <StatusBadge tone={tone.shelter[shelter.status]}>{L.shelterStatus[shelter.status]}</StatusBadge>
      </div>
      <div className="mt-3">
        <OccupancyLine shelter={shelter} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <FacilityIcons facilities={shelter.facilities} />
        {shelter.facilities.includes("accessible") && <span className="text-xs font-medium text-[#0a6567]">Step-free access</span>}
      </div>
    </button>
  );
}
