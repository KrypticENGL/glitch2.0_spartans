import type { Metadata } from "next";
import { OperationsMap } from "@/components/dashboard/operations-map";

export const metadata: Metadata = { title: "Operations map" };

export default function OperationsMapPage() {
  return <OperationsMap />;
}
