"use client";

import { useEffect, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerManager } from "@/components/pwa/sw-manager";
import { useDemoStore } from "@/store/demo-store";

export function Providers({ children }: { children: ReactNode }) {
  // Load persisted demo state after mount, so the first client render matches the server HTML.
  useEffect(() => {
    void useDemoStore.persist.rehydrate();
  }, []);
  return (
    <TooltipProvider delayDuration={300}>
      {children}
      <ServiceWorkerManager />
      <Toaster theme="light" position="top-center" richColors closeButton />
    </TooltipProvider>
  );
}
