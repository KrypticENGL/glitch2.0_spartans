"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Gauge, Megaphone, House, LifeBuoy, Map, RotateCcw, ShieldAlert, Siren, Tent } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./brand";
import { DemoBadge } from "@/components/shared/status";
import { useDemoStore } from "@/store/demo-store";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/dashboard/map", label: "Operations map", icon: Map },
  { href: "/dashboard/incidents", label: "Incidents", icon: Siren, badge: "incidents" as const },
  { href: "/dashboard/rescue", label: "Rescue coordination", icon: LifeBuoy },
  { href: "/dashboard/shelters", label: "Shelters", icon: Tent },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/alerts", label: "Alert management", icon: Megaphone },
];

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));

export function DashboardShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const unassigned = useDemoStore((s) => s.incidents.filter((i) => i.status === "new").length);
  const resetDemo = useDemoStore((s) => s.resetDemo);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-3 py-3">
          <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden rounded-md">
            <BrandMark className="size-8 shrink-0" />
            <span className="leading-none group-data-[collapsible=icon]:hidden">
              <span className="block text-[15px] font-extrabold tracking-[0.08em] text-white">SURAKSHA</span>
              <span className="mt-0.5 block text-[11px] text-sidebar-foreground">Darbhanga operations</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/70">Command</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map(({ href, label, icon: Icon, badge }) => {
                  const active = href === "/dashboard" ? path === href : path.startsWith(href);
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label} className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-white">
                        <Link href={href} aria-current={active ? "page" : undefined}>
                          <Icon />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge && unassigned > 0 && (
                        <SidebarMenuBadge className="bg-danger text-white peer-data-[active=true]/menu-button:text-white" aria-label={`${unassigned} new incidents`}>
                          {unassigned}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/70">Other views</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Responder app">
                    <Link href="/responder"><ShieldAlert /><span>Responder app</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Citizen app">
                    <Link href="/"><House /><span>Citizen app</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-3 pb-3 text-[11px] leading-snug text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
          Demonstration mode. All operational data is simulated and stored only in this browser.
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-3 md:px-4">
          <SidebarTrigger aria-label="Toggle navigation" />
          <span className="h-5 w-px bg-border" aria-hidden />
          <h1 className="truncate text-base font-semibold">{TITLES[path] ?? "Operations"}</h1>
          <DemoBadge className="ml-1 hidden sm:inline-flex" label="Demonstration mode" />
          <DemoBadge className="sm:hidden" label="Demo" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <RotateCcw /> <span className="hidden sm:inline">Reset demo data</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all demonstration data?</AlertDialogTitle>
                <AlertDialogDescription>
                  SOS requests, hazard reports, assignments, mission updates and shelter edits made in this browser will be replaced by the original scenario.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current data</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    resetDemo();
                    toast.success("Demo data reset to the original scenario");
                  }}
                >
                  Reset data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </header>
        <div id="main" className="min-w-0 flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
