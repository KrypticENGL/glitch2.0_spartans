"use client";

import { useEffect } from "react";
import { StatusBadge } from "@/components/shared/status";
import { formatTime } from "@/lib/format";
import { SEVERITY_LABEL, SEVERITY_TONE } from "@/features/notifications/api";
import { isCurrent, useAlerts } from "@/features/notifications/alerts-store";

/** Last alerts this device received, clearly marked as a saved copy. */
export function OfflineSaved() {
  const { alerts, fetchedAt } = useAlerts();
  useEffect(() => void useAlerts.persist.rehydrate(), []);
  const current = alerts.filter(isCurrent).slice(0, 5);
  if (!fetchedAt) return null;
  return (
    <section aria-labelledby="saved-h" className="space-y-2">
      <h2 id="saved-h" className="font-semibold">Saved alerts</h2>
      <p className="text-xs text-muted-foreground">Saved at {formatTime(fetchedAt)}. Not live: newer alerts may exist.</p>
      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active alerts were saved.</p>
      ) : (
        <ul className="space-y-2">
          {current.map((a) => (
            <li key={a.id} className="rounded-lg border bg-card p-3">
              <StatusBadge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</StatusBadge>
              <p className="mt-1 text-sm font-semibold" lang={a.language}>{a.title}</p>
              <p className="text-sm text-muted-foreground" lang={a.language}>{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
