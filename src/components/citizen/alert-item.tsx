import type { EmergencyAlert } from "@/types";
import { L, formatTime, tone } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status";

export function AlertItem({ alert }: { alert: EmergencyAlert }) {
  return (
    <li className="rounded-lg border bg-card p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone.alert[alert.severity]}>{L.alert[alert.severity]}</StatusBadge>
        <span className="text-xs text-muted-foreground">{alert.area} · {formatTime(alert.issuedAt)}</span>
      </div>
      <p className="mt-1.5 font-semibold">{alert.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{alert.body}</p>
    </li>
  );
}
