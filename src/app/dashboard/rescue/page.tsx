import type { Metadata } from "next";
import { RescueCoordination } from "@/components/dashboard/rescue-coordination";

export const metadata: Metadata = { title: "Rescue coordination" };

export default function RescuePage() {
  return <RescueCoordination />;
}
