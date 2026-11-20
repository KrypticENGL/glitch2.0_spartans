import type { Metadata } from "next";
import { Brand } from "@/components/layout/brand";
import { OfflineSaved } from "@/components/pwa/offline-saved";

export const metadata: Metadata = { title: "Offline" };

/** Precached by the service worker; shown when a page can’t load and no saved copy exists. */
export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-8">
      <Brand sub="Offline" />
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">You’re offline</h1>
        <p className="text-muted-foreground">This page isn’t saved on your device. Saved pages: Home, Shelters, Routes and Alerts, if you opened them before.</p>
        <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-[#a3241e]">
          Emergency requests can’t be sent without a connection. If you need rescue now, call 112.
        </p>
      </div>
      <OfflineSaved />
      {/* Full navigation on purpose: retries the network through the service worker. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="inline-flex h-11 w-fit items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">Try again</a>
    </main>
  );
}
