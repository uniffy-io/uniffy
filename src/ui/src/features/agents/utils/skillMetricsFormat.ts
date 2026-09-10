import type { SerializedSkillMetric } from "@/features/agents/store/agentSkillMetricsThunks";

/** Rendered when a figure has no basis, such as a rate over zero invocations. */
export const NO_VALUE = "–";

export function formatCount(value: number): string {
  return value.toLocaleString();
}

export function formatCompactCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

/** Share of `part` in `whole` as a whole percent; tiny non-zero shares read as "<1%". */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return NO_VALUE;
  if (part <= 0) return "0%";
  const percent = (part / whole) * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function formatDurationMs(ms: number): string {
  if (ms >= 3_600_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export interface OutcomeCount {
  key: "completed" | "failed" | "rejected" | "cancelled" | "started";
  label: string;
  count: number;
}

/** Every recorded outcome of a version, zero ones included, in a stable order. */
export function invocationOutcomes(row: SerializedSkillMetric): OutcomeCount[] {
  return [
    { key: "completed", label: "completed", count: row.completedCount },
    { key: "failed", label: "failed", count: row.failedCount },
    { key: "rejected", label: "rejected", count: row.rejectedCount },
    { key: "cancelled", label: "cancelled", count: row.cancelledCount },
    { key: "started", label: "still running", count: row.startedCount },
  ];
}

export type RunLogCoverage = "none" | "partial" | "full";

/**
 * Duration, tokens and cost exist only for invocations with a correlated run
 * log, so a low figure can mean little usage or little coverage. Callers show
 * the coverage beside every derived figure instead of letting zero stand in.
 */
export function runLogCoverage(row: SerializedSkillMetric): RunLogCoverage {
  if (row.runLogCount <= 0) return "none";
  return row.runLogCount < row.invocationCount ? "partial" : "full";
}

export function formatRunLogCoverage(row: SerializedSkillMetric): string {
  if (row.runLogCount <= 0) return "No run logs";
  return `${formatCount(row.runLogCount)} of ${formatCount(row.invocationCount)}`;
}

/** Mean wall time per logged run; nothing when no run log was correlated. */
export function formatAverageDuration(row: SerializedSkillMetric): string {
  if (row.runLogCount <= 0) return NO_VALUE;
  return formatDurationMs(row.durationMs / row.runLogCount);
}

/** Groups skill-filtered rows by version, newest version first. */
export function sortByVersionDesc(rows: SerializedSkillMetric[]): SerializedSkillMetric[] {
  return [...rows].sort(
    (a, b) =>
      b.skillVersionNumber - a.skillVersionNumber ||
      a.skillVersionId.localeCompare(b.skillVersionId),
  );
}

/** Org-wide rows read by skill name, then newest version first within a skill. */
export function sortBySkillThenVersionDesc(rows: SerializedSkillMetric[]): SerializedSkillMetric[] {
  return [...rows].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      a.skillId.localeCompare(b.skillId) ||
      b.skillVersionNumber - a.skillVersionNumber ||
      a.skillVersionId.localeCompare(b.skillVersionId),
  );
}
