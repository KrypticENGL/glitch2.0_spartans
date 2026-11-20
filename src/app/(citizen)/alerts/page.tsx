import type { Metadata } from "next";
import { SEED_ALERTS } from "@/data/mock/seed";
import { ROAD_SEGMENTS } from "@/data/mock/road-segments";
import { AlertItem } from "@/components/citizen/alert-item";
import { DemoBadge, StatusBadge } from "@/components/shared/status";
import { L, tone } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Alerts for Darbhanga</h1>
        <DemoBadge label="Simulated alerts" />
      </div>
      <p className="text-sm text-muted-foreground">
        These alerts are part of the demonstration scenario, not live warnings. Official flood bulletins come from the Bihar State Disaster Management Authority and the district administration.
      </p>
      <ul className="space-y-2.5">
        {SEED_ALERTS.map((a) => <AlertItem key={a.id} alert={a} />)}
      </ul>
      <section aria-labelledby="road-h" className="space-y-3">
        <h2 id="road-h" className="text-lg font-bold">Road conditions</h2>
        <ul className="divide-y rounded-lg border bg-card">
          {ROAD_SEGMENTS.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 p-3">
              <span>
                <span className="block text-sm font-semibold">{r.name}</span>
                <span className="block text-sm text-muted-foreground">{r.note}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{r.verified ? "Confirmed by field team (simulated)" : "Citizen report, not yet confirmed"}</span>
              </span>
              <StatusBadge tone={tone.road[r.condition]}>{L.road[r.condition]}</StatusBadge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
