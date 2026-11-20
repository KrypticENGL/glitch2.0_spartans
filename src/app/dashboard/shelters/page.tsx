import type { Metadata } from "next";
import { ShelterManagement } from "@/components/dashboard/shelter-management";

export const metadata: Metadata = { title: "Shelter management" };

export default function ShelterManagementPage() {
  return <ShelterManagement />;
}
