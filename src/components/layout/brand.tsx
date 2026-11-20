import Link from "next/link";
import { cn } from "@/lib/utils";

/** Mark: a shelter roofline held above two water lines. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#1B3034" />
      <path d="M8 15.5 16 9l8 6.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15v4h10v-4" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M6.5 23c2.4-1.6 4.4-1.6 6.4 0s4 1.6 6.3 0 4.2-1.6 6.3 0" fill="none" stroke="#70D1C4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ href = "/", sub, invert }: { href?: string; sub?: string; invert?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-md">
      <BrandMark />
      <span className="leading-none">
        <span className={cn("block text-[15px] font-extrabold tracking-[0.08em]", invert ? "text-white" : "text-primary")}>SURAKSHA</span>
        {sub && <span className={cn("mt-0.5 block text-[11px] font-medium", invert ? "text-sidebar-foreground" : "text-muted-foreground")}>{sub}</span>}
      </span>
    </Link>
  );
}
