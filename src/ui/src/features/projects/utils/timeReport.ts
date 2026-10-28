import type { AggregateGroupBy, AggregateRow } from "@/features/projects/types/time";
import { addDays, weekStartOf, type WeekStart } from "@/features/projects/utils/timeWeek";

export type ReportPreset = "week" | "month" | "quarter";

export const PRESET_LABEL: Record<ReportPreset, string> = {
  week: "This week",
  month: "4 weeks",
  quarter: "12 weeks",
};

export const GROUP_LABEL: Record<AggregateGroupBy, string> = {
  user: "Person",
  task: "Task",
  day: "Day",
};

/** Bars past this count would be too thin to read; the table below still lists every row. */
export const CHART_ROW_LIMIT = 12;

export function presetRange(
  preset: ReportPreset,
  today: string,
  weekStart: WeekStart,
): { from: string; to: string } {
  if (preset === "week") {
    const start = weekStartOf(today, weekStart);
    return { from: start, to: addDays(start, 6) };
  }
  const days = preset === "month" ? 28 : 84;
  return { from: addDays(today, -(days - 1)), to: today };
}

export function rangeIsValid(from: string, to: string): boolean {
  return Boolean(from && to) && from <= to;
}

/** Rows the chart draws: the biggest ones, days in calendar order. */
export function chartRows(
  rows: readonly AggregateRow[],
  groupBy: AggregateGroupBy,
): AggregateRow[] {
  if (groupBy === "day") return rows.slice(0, CHART_ROW_LIMIT);
  return [...rows].sort((a, b) => b.minutes - a.minutes).slice(0, CHART_ROW_LIMIT);
}

export function shareOf(minutes: number, total: number): string {
  if (total <= 0) return "";
  return `${Math.round((minutes / total) * 100)}%`;
}

/** Axis ticks read as hours; minutes only when the whole range is under an hour. */
export function hoursTick(minutes: number): string {
  if (minutes === 0) return "0";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

/** Axis labels get one short line; the full name lives in the tooltip and the table. */
export function axisLabel(label: string, max = 22): string {
  const text = label.trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function dayTick(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${day}/${month}`;
}
