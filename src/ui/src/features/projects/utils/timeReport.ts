import { isMatch } from "date-fns";
import type {
  AggregateGroupBy,
  AggregateRow,
  ReportPreset,
  TimeReportState,
} from "@/features/projects/types/time";
import { addDays, weekStartOf, type WeekStart } from "@/features/projects/utils/timeWeek";

export type { ReportPreset, TimeReportState } from "@/features/projects/types/time";

export function readTimeReportState(
  params: URLSearchParams,
  today: string,
  weekStart: WeekStart,
  saved?: TimeReportState,
): TimeReportState {
  if (saved && !["preset", "from", "to", "groupBy"].some((key) => params.has(key))) {
    return readTimeReportState(timeReportSearchParams(params, saved), today, weekStart);
  }
  const rawPreset = params.get("preset");
  const preset =
    rawPreset === "week" || rawPreset === "month" || rawPreset === "quarter"
      ? rawPreset
      : rawPreset === "custom" || params.has("from") || params.has("to")
        ? null
        : "month";
  const fallback = presetRange(preset ?? "month", today, weekStart);
  const date = (edge: "from" | "to") => {
    const value = params.get(edge);
    return value !== null && (value === "" || isMatch(value, "yyyy-MM-dd"))
      ? value
      : fallback[edge];
  };
  const groupBy = params.get("groupBy");
  return {
    preset,
    from: date("from"),
    to: date("to"),
    groupBy: groupBy === "task" || groupBy === "day" ? groupBy : "user",
  };
}

export function timeReportSearchParams(params: URLSearchParams, state: TimeReportState) {
  const next = new URLSearchParams(params);
  next.set("preset", state.preset ?? "custom");
  next.set("from", state.from);
  next.set("to", state.to);
  next.set("groupBy", state.groupBy);
  return next;
}

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
