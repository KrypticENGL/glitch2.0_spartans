import type { RiskLevel, RiskObservation, RiskSource, TimelineEvent } from "@/types";

export function observationsAt(
  observations: RiskObservation[],
  timestamp: number,
  levels: ReadonlySet<RiskLevel>,
  sources: ReadonlySet<RiskSource>,
): RiskObservation[] {
  return observations.filter((item) => Date.parse(item.timestamp) <= timestamp && levels.has(item.level) && sources.has(item.source));
}

export function recordsAt<T extends { reportedAt: string }>(records: T[], timestamp: number): T[] {
  return records.filter((item) => Date.parse(item.reportedAt) <= timestamp);
}

export function eventsAt(events: TimelineEvent[], timestamp: number): TimelineEvent[] {
  return events.filter((item) => Date.parse(item.timestamp) <= timestamp);
}

export function riskSummary(observations: RiskObservation[]) {
  return observations.reduce((summary, item) => {
    summary[item.level] += 1;
    return summary;
  }, { low: 0, moderate: 0, high: 0, severe: 0 } satisfies Record<RiskLevel, number>);
}
