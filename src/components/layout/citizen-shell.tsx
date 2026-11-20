"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, House, LifeBuoy, MapPin, Route, ShieldAlert, TriangleAlert, LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { DemoBadge } from "@/components/shared/status";
import { DEMO_REGION } from "@/config/geo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/shelters", label: "Shelters", icon: MapPin },
  { href: "/evacuation", label: "Routes", icon: Route },
  { href: "/sos", label: "SOS", icon: LifeBuoy },
  { href: "/reports", label: "Report hazard", short: "Report", icon: TriangleAlert },
  { href: "/alerts", label: "Alerts", icon: Bell },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function CitizenShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Brand sub={`${DEMO_REGION.name}, ${DEMO_REGION.state}`} />
          <DemoBadge className="hidden sm:inline-flex" label="Demonstration mode" />
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(path, href) ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
                  isActive(path, href) && "bg-secondary text-foreground",
                  href === "/sos" && "text-danger hover:text-danger",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <Link href="/dashboard" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <LayoutDashboard className="size-4" aria-hidden /> Operations
            </Link>
            <Link href="/responder" className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <ShieldAlert className="size-4" aria-hidden /> Responder
            </Link>
          </nav>
          <DemoBadge className="ml-auto sm:hidden" label="Demo" />
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col pb-16 md:pb-0">
        {children}
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-6 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ href, label, short, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground",
                active && "text-primary",
                href === "/sos" && "text-danger",
              )}
            >
              <Icon className={cn("size-5", active && "stroke-[2.4]")} aria-hidden />
              {short ?? label}
              <span className={cn("h-0.5 w-6 rounded-full", active ? "bg-teal" : "bg-transparent")} aria-hidden />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
