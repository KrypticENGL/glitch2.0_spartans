import type { Metadata } from "next";
import { Suspense } from "react";
import { EvacuationPlanner } from "@/components/evacuation/evacuation-planner";

export const metadata: Metadata = { title: "Evacuation routes" };

export default function EvacuationPage() {
  // useSearchParams (destination shelter) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-[calc(100dvh-3.5rem)] animate-pulse bg-[#dfe6ec]" />}>
      <EvacuationPlanner />
    </Suspense>
  );
}
