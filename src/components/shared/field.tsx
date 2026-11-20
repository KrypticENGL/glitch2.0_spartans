import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Label + control + hint/error, wired with aria-describedby. Pass the same id to the control. */
export function Field({ id, label, hint, error, children, optional }: { id: string; label: string; hint?: string; error?: string; children: ReactNode; optional?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-sm font-medium text-[#a3241e]">{error}</p>}
    </div>
  );
}

export const describedBy = (id: string, error?: string, hint?: string) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);
