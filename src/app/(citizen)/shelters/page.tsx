import type { Metadata } from "next";
import { ShelterLocator } from "@/components/shelters/shelter-locator";

export const metadata: Metadata = { title: "Nearby shelters" };

export default function SheltersPage() {
  return <ShelterLocator />;
}
