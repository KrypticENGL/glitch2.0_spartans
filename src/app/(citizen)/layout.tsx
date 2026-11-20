import type { ReactNode } from "react";
import { CitizenShell } from "@/components/layout/citizen-shell";

export default function CitizenLayout({ children }: { children: ReactNode }) {
  return <CitizenShell>{children}</CitizenShell>;
}
