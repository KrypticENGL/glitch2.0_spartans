"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { StatusBadge } from "@/components/shared/status";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, SEVERITY_TONE } from "@/features/notifications/api";
import { connectAlerts, isCurrent, relevant, useAlerts } from "@/features/notifications/alerts-store";

/** Alerts sent from the operations console (persisted in the API), newest first. */
export function LiveAlerts() {
  const { alerts, areas, status, fetchedAt, markRead } = useAlerts();
  const focus = useSearchParams().get("alert");
  useEffect(connectAlerts, []);

  const list = useMemo(() => alerts.filter((a) => a.id === focus || (relevant(a, areas) && isCurrent(a))), [alerts, areas, focus]);
  useEffect(() => {
    if (!focus) return;
    markRead(focus);
    document.getElementById(`alert-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, markRead, list.length]);

  return (
    <section aria-labelledby="live-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-h" className="text-lg font-bold">From the operations team</h2>
        <p className="text-xs text-muted-foreground" role="status">
          {status === "live" && fetchedAt && `Live · updated ${formatTime(fetchedAt)}`}
          {(status === "offline" || status === "error") && (fetchedAt ? `Saved copy from ${formatTime(fetchedAt)} — not live` : "Can’t reach the server")}
          {status === "loading" && "Loading…"}
        </p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">No active alerts{areas.length ? " for your areas" : ""}. New alerts appear here as soon as they are sent.</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((a) => (
            <li key={a.id} id={`alert-${a.id}`} className={cn("rounded-lg border bg-card p-3.5", a.id === focus && "border-teal ring-2 ring-teal/25")}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</StatusBadge>
                {a.classification === "demo" && <StatusBadge tone="muted" icon={false}>Simulated</StatusBadge>}
                {!isCurrent(a) && <StatusBadge tone="muted" icon={false}>Expired</StatusBadge>}
                <span className="text-xs text-muted-foreground">
                  {a.targetAreaLabel}
                  {a.sentAt && ` · ${formatTime(a.sentAt)}`}
                  {a.expiresAt && ` · until ${formatTime(a.expiresAt)}`}
                </span>
              </div>
              <p className="mt-1.5 font-semibold" lang={a.language}>{a.title}</p>
              <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground" lang={a.language}>{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
