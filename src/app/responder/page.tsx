import type { Metadata } from "next";
import { ResponderApp } from "@/components/responder/responder-app";

export const metadata: Metadata = { title: "Responder" };

export default function ResponderPage() {
  return <ResponderApp />;
}
