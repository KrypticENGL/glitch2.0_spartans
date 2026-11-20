"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, House, LayoutDashboard, LifeBuoy, MapPin, Route, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DemoBadge } from "@/components/shared/status";
import { DEMO_REGION } from "@/config/geo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/shelters", label: "Shelters", icon: MapPin },
  { href: "/evacuation", label: "Routes", icon: Route },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/reports", label: "Report", icon: TriangleAlert },
];

const MOBILE_NAV = [...NAV, { href: "/sos", label: "Rescue", icon: LifeBuoy }];
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function CitizenShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="mx-auto flex h-[60px] max-w-[1700px] items-center gap-5 px-4 md:px-7">
          <Brand sub={`${DEMO_REGION.name}, ${DEMO_REGION.state}`} />
          <DemoBadge className="hidden xl:inline-flex" label="Demonstration" />
          <nav aria-label="Citizen navigation" className="ml-auto hidden h-full items-center gap-1 lg:flex">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined} className={cn(
                "relative inline-flex h-full items-center px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                isActive(path, href) && "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-teal",
              )}>{label}</Link>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-2 border-l pl-4 lg:flex">
            <NotificationBell />
            <Link href="/dashboard" className="rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><LayoutDashboard className="mr-1.5 inline size-3.5" aria-hidden />Operations</Link>
            <Link href="/responder" className="rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><ShieldAlert className="mr-1.5 inline size-3.5" aria-hidden />Responder</Link>
            <Link href="/sos" className="ml-1 inline-flex h-9 items-center gap-2 rounded-md bg-danger px-3.5 text-sm font-semibold text-white hover:bg-danger/90"><LifeBuoy className="size-4" aria-hidden />Emergency help</Link>
          </div>
          <div className="ml-auto flex items-center gap-1 lg:hidden"><DemoBadge label="Demo" /><NotificationBell /></div>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-6 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          const emergency = href === "/sos";
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-muted-foreground",
              active && !emergency && "text-teal",
              emergency && "text-danger",
            )}>
              <span className={cn("grid size-7 place-items-center rounded-md", emergency && "bg-danger/10", active && !emergency && "bg-teal/10")}><Icon className="size-[17px]" aria-hidden /></span>
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
