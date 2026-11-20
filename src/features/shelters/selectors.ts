import type { Shelter } from "@/types";
import { SEED_SHELTERS } from "@/data/mock/seed";
import { shelterDistanceM } from "@/features/routing/adapter";

// Road distance from the demo location never changes at runtime, so compute once.
export const SHELTER_DISTANCE: Record<string, number | undefined> = Object.fromEntries(SEED_SHELTERS.map((s) => [s.id, shelterDistanceM(s.id)]));

export type ShelterFilter = "all" | "accepting" | "medical" | "accessible";

export const SHELTER_FILTERS: { id: ShelterFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "accepting", label: "Has space" },
  { id: "medical", label: "Medical aid" },
  { id: "accessible", label: "Accessible" },
];

export function filterShelters(shelters: Shelter[], query: string, filter: ShelterFilter): Shelter[] {
  const q = query.trim().toLowerCase();
  return shelters
    .filter((s) => !q || `${s.name} ${s.location.area} ${s.kind}`.toLowerCase().includes(q))
    .filter((s) =>
      filter === "accepting" ? s.status === "open" || s.status === "near_capacity"
      : filter === "medical" ? s.facilities.includes("medical")
      : filter === "accessible" ? s.facilities.includes("accessible")
      : true,
    )
    .sort((a, b) => (SHELTER_DISTANCE[a.id] ?? Infinity) - (SHELTER_DISTANCE[b.id] ?? Infinity));
}
