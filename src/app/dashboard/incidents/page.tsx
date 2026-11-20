import type { Metadata } from "next";
import { IncidentQueue } from "@/components/dashboard/incident-queue";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return <IncidentQueue />;
}
