"use client";

import { WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** Registers the service worker, offers updates instead of forcing them, and shows an offline banner. */
export function ServiceWorkerManager() {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  useEffect(() => {
    // Dev builds are skipped: cache-first on unhashed dev chunks would serve stale code.
    if (!("serviceWorker" in navigator) || (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_ENABLE_SW_DEV !== "1")) return;
    let reloading = false;
    const offerUpdate = (worker: ServiceWorker) =>
      toast("A new version of SURAKSHA is ready", {
        duration: Infinity,
        action: { label: "Update now", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
      });
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) offerUpdate(next);
          });
        });
      })
      .catch(() => undefined); // the site works without it
    const onController = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const onMessage = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === "suraksha:navigate" && typeof e.data.url === "string" && e.data.url.startsWith("/") && !e.data.url.startsWith("//")) router.push(e.data.url);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);

  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
      <WifiOff className="size-3.5" aria-hidden />
      You’re offline. Pages and alerts shown are saved copies, not live information.
    </div>
  );
}
