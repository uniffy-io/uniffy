import type { SerializedDayTotal, SerializedWorklog } from "@features/projects/timeSerializer";

export type WeekStart = "monday" | "saturday" | "sunday";

const WEEK_START_INDEX: Record<WeekStart, number> = { sunday: 0, monday: 1, saturday: 6 };
const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Day keys are calendar days with no instant behind them, so the arithmetic runs in UTC on purpose. */
function utcOf(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function keyOf(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key: string, days: number): string {
  return keyOf(utcOf(key) + days * DAY_MS);
}

export function normalizeWeekStart(value: string | null | undefined): WeekStart {
  return value === "sunday" || value === "saturday" ? value : "monday";
}

export function weekStartOf(key: string, weekStart: WeekStart): string {
  const offset = (new Date(utcOf(key)).getUTCDay() - WEEK_START_INDEX[weekStart] + 7) % 7;
  return addDays(key, -offset);
}

export function weekDays(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startKey, index));
}

export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[new Date(utcOf(key)).getUTCDay()];
}

export function dayOfMonth(key: string): number {
  return new Date(utcOf(key)).getUTCDate();
}

/** "Oct 19 to 25" inside one month, "Oct 29 to Nov 4" across two. */
export function formatDayRange(from: string, to: string): string {
  const first = new Date(utcOf(from));
  const last = new Date(utcOf(to));
  const start = `${MONTH_SHORT[first.getUTCMonth()]} ${first.getUTCDate()}`;
  const end =
    first.getUTCMonth() === last.getUTCMonth()
      ? `${last.getUTCDate()}`
      : `${MONTH_SHORT[last.getUTCMonth()]} ${last.getUTCDate()}`;
  return `${start} to ${end}`;
}

/** "Wednesday, Oct 22". */
export function formatDayLong(key: string): string {
  const date = new Date(utcOf(key));
  return `${WEEKDAY_LONG[date.getUTCDay()]}, ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** Entries grouped by their day, oldest first inside a day. */
export function entriesByDay(
  worklogs: readonly SerializedWorklog[],
): Record<string, SerializedWorklog[]> {
  const byDay: Record<string, SerializedWorklog[]> = {};
  const ordered = [...worklogs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const entry of ordered) {
    (byDay[entry.workDate] ??= []).push(entry);
  }
  return byDay;
}

export function dayTotals(
  worklogs: readonly SerializedWorklog[],
  days: readonly string[],
): Record<string, number> {
  const totals: Record<string, number> = Object.fromEntries(days.map((day) => [day, 0]));
  for (const entry of worklogs) {
    if (entry.workDate in totals) totals[entry.workDate] += entry.durationMinutes;
  }
  return totals;
}

export interface DayRequirement {
  required: number;
  off: boolean;
}

/** What each day asks; a day the server did not describe asks nothing. */
export function requirementsFor(
  days: readonly string[],
  served: readonly SerializedDayTotal[],
): Record<string, DayRequirement> {
  const byDay = new Map(served.map((total) => [total.day, total]));
  return Object.fromEntries(
    days.map((day) => {
      const known = byDay.get(day);
      return [day, { required: known?.requiredMinutes ?? 0, off: known?.off ?? false }];
    }),
  );
}

export type DayStatus = "none" | "logged" | "under" | "met" | "over";

export function dayStatus(total: number, required: number): DayStatus {
  if (required <= 0) return total > 0 ? "logged" : "none";
  if (total === 0) return "none";
  if (total < required) return "under";
  return total === required ? "met" : "over";
}

/** The word under a day that is away: a whole day off, or half of one. */
export function offLabel(required: number, off: boolean): string | null {
  if (!off) return null;
  return required > 0 ? "half day" : "off";
}
