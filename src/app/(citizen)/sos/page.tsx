import type { Metadata } from "next";
import { SOSFormView, RealEmergencyNote } from "@/components/citizen/sos-form";
import { DemoBadge } from "@/components/shared/status";

export const metadata: Metadata = { title: "Request rescue" };

export default function SOSPage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Request rescue</h1>
        <DemoBadge label="Demo: nothing is dispatched" />
      </div>
      <RealEmergencyNote />
      <SOSFormView />
    </div>
  );
}
