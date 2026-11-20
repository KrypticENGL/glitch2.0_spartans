"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDemoStore } from "@/store/demo-store";
import { L } from "@/lib/format";
import { IncidentDetail } from "./incident-detail";

/** Side drawer with full incident detail and operator actions. */
export function IncidentSheet({ incidentId, onClose }: { incidentId: string | null; onClose: () => void }) {
  const incident = useDemoStore((s) => s.incidents.find((i) => i.id === incidentId));
  return (
    <Sheet open={!!incident} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {incident && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>{incident.id} · {L.incidentType[incident.type]}</SheetTitle>
              <SheetDescription>Demonstration incident. Changes stay in this browser.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <IncidentDetail incident={incident} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
