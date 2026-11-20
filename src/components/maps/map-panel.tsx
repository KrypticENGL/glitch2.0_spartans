"use client";

import { ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SheetSize = "peek" | "half" | "full";
const NEXT: Record<SheetSize, SheetSize> = { peek: "half", half: "full", full: "peek" };
export const SHEET_HEIGHT: Record<SheetSize, string> = { peek: "h-[148px]", half: "h-[46dvh]", full: "h-[calc(100dvh-8.5rem)]" };
/** Pixel estimate of the sheet height for map padding (mobile only). */
export const sheetPx = (s: SheetSize) => (typeof window === "undefined" ? 300 : s === "peek" ? 148 : s === "half" ? window.innerHeight * 0.46 : window.innerHeight - 136);

interface Props {
  title: string;
  header?: ReactNode;
  children: ReactNode;
  size: SheetSize;
  onSizeChange: (s: SheetSize) => void;
  className?: string;
}

/**
 * Desktop: a floating column beside the map. Mobile: a non-modal bottom sheet, so the map stays usable.
 */
export function MapPanel({ title, header, children, size, onSizeChange, className }: Props) {
  return (
    <section
      aria-label={title}
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-xl border-t bg-background shadow-[0_-4px_16px_rgb(14_34_53/0.12)] transition-[height] duration-200",
        SHEET_HEIGHT[size],
        "md:top-3 md:bottom-3 md:left-3 md:h-auto md:w-[400px] md:rounded-xl md:border md:shadow-[0_2px_10px_rgb(14_34_53/0.12)]",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSizeChange(NEXT[size])}
        className="flex h-6 w-full shrink-0 items-center justify-center md:hidden"
        aria-label={size === "full" ? "Collapse panel" : "Expand panel"}
        aria-expanded={size !== "peek"}
      >
        <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
        <ChevronUp className={cn("sr-only", size === "full" && "rotate-180")} />
      </button>
      {header && <div className="shrink-0 border-b px-4 pb-3 md:pt-4">{header}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
    </section>
  );
}
