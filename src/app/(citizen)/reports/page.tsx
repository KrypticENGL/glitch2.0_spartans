import type { Metadata } from "next";
import { HazardFormView } from "@/components/citizen/hazard-form";
import { DemoBadge } from "@/components/shared/status";

export const metadata: Metadata = { title: "Report a road hazard" };

export default function ReportsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Report a road hazard</h1>
        <DemoBadge />
      </div>
      <p className="text-sm text-muted-foreground">
        Reports help operators decide where to send field teams. A report does not close a road by itself: it stays unverified until an operator confirms it.
      </p>
      <HazardFormView />
    </div>
  );
}
