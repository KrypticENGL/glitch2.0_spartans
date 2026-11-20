import type { Metadata } from "next";
import { AlertConsole } from "@/components/dashboard/alert-console";

export const metadata: Metadata = { title: "Alert management" };

export default function AlertManagementPage() {
  return <AlertConsole />;
}
