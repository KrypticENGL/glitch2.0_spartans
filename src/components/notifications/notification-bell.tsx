"use client";

import Link from "next/link";
import { Bell, Settings2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/shared/status";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, SEVERITY_TONE } from "@/features/notifications/api";
import { connectAlerts, isCurrent, relevant, useAlerts } from "@/features/notifications/alerts-store";

export function NotificationBell({ className }: { className?: string }) {
  const { alerts, readIds, areas, status, fetchedAt, markRead, markAllRead } = useAlerts();
  useEffect(connectAlerts, []);

  const mine = useMemo(() => alerts.filter((a) => relevant(a, areas) && isCurrent(a)), [alerts, areas]);
  const unread = mine.filter((a) => !readIds.includes(a.id)).length;
  const stale = status === "offline" || status === "error";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("relative grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", className)}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <p className="text-sm font-semibold">Alerts</p>
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="rounded px-1.5 py-1 text-xs font-medium text-teal hover:bg-muted">
              Mark all as read
            </button>
          )}
        </div>
        {stale && fetchedAt && (
          <p className="border-b bg-warn/10 px-3.5 py-2 text-xs text-[#8a5806]">Can’t reach the server. Saved at {formatTime(fetchedAt)}; may be out of date.</p>
        )}
        <ul className="max-h-[60vh] divide-y overflow-y-auto" aria-live="polite">
          {mine.length === 0 && (
            <li className="px-3.5 py-6 text-center text-sm text-muted-foreground">{status === "loading" ? "Loading alerts…" : "No active alerts for your areas."}</li>
          )}
          {mine.slice(0, 8).map((a) => {
            const isUnread = !readIds.includes(a.id);
            return (
              <li key={a.id}>
                <Link href={`/alerts?alert=${a.id}`} onClick={() => markRead(a.id)} className="block px-3.5 py-3 hover:bg-muted/50">
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</StatusBadge>
                    <span className="truncate text-xs text-muted-foreground">
                      {a.targetAreaLabel}
                      {a.sentAt && ` · ${formatTime(a.sentAt)}`}
                    </span>
                    {isUnread && <span className="ml-auto size-2 shrink-0 rounded-full bg-teal" aria-label="Unread" />}
                  </span>
                  <span className={cn("mt-1 block text-sm", isUnread ? "font-semibold" : "font-medium text-muted-foreground")}>{a.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link href="/alerts#notifications" className="flex items-center gap-2 border-t px-3.5 py-2.5 text-sm font-medium text-teal hover:bg-muted/50">
          <Settings2 className="size-4" aria-hidden />
          Notification settings
        </Link>
      </PopoverContent>
    </Popover>
  );
}
