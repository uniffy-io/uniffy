import type { DayTotal, Worklog } from "@/features/projects/types/time";

export type WeekStart = "monday" | "saturday" | "sunday";

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

const WEEK_START_INDEX: Record<WeekStart, number> = { sunday: 0, monday: 1, saturday: 6 };
const DAY_MS = 86_400_000;

export interface WeekRowRef {
  taskId: string;
  projectId: string;
}

export interface WeekRow extends WeekRowRef {
  cells: Record<string, Worklog[]>;
}

export interface RequirementRule {
  requiredMinutesPerDay: number;
  workdays: readonly string[];
  /** YYYY-MM-DD days with zero required minutes. */
  holidays: readonly string[];
}

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

export function weekdayOf(key: string): WeekdayName {
  return WEEKDAY_NAMES[new Date(utcOf(key)).getUTCDay()];
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon" to "Sun" for a day key. */
export function weekdayShort(key: string): string {
  return WEEKDAY_SHORT[new Date(utcOf(key)).getUTCDay()];
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

export function weekRangeKey(from: string, to: string): string {
  return `${from}:${to}`;
}

/** The canonical content URN the mention resolver serves. */
export function taskUrn(taskId: string): string {
  return `urn:uniffy:content:TASK:${taskId}`;
}

export function requiredMinutesOn(key: string, rule: RequirementRule): number {
  if (rule.holidays.includes(key)) return 0;
  return rule.workdays.includes(weekdayOf(key)) ? rule.requiredMinutesPerDay : 0;
}

/** What each day asks, preferring the server's answer (which knows about days off). */
export function requirementsFor(
  days: readonly string[],
  served: readonly DayTotal[],
  rule: RequirementRule,
): Record<string, { required: number; off: boolean }> {
  const byDay = new Map(served.map((day) => [day.day, day]));
  return Object.fromEntries(
    days.map((day) => {
      const known = byDay.get(day);
      return [
        day,
        known
          ? { required: known.requiredMinutes, off: known.off }
          : { required: requiredMinutesOn(day, rule), off: rule.holidays.includes(day) },
      ];
    }),
  );
}

/** The word under a day that is away: a whole day off, or half of one. */
export function offLabel(required: number, off: boolean): string | null {
  if (!off) return null;
  return required > 0 ? "half day" : "off";
}

export function sumMinutes(worklogs: readonly Worklog[]): number {
  return worklogs.reduce((total, entry) => total + entry.durationMinutes, 0);
}

function byDayThenCreation(a: Worklog, b: Worklog): number {
  return a.workDate.localeCompare(b.workDate) || a.createdAt.localeCompare(b.createdAt);
}

/** One row per task in order of first appearance; extra rows follow, deduplicated against them. */
export function buildWeekRows(
  worklogs: readonly Worklog[],
  days: readonly string[],
  extraRows: readonly WeekRowRef[] = [],
): WeekRow[] {
  const dayset = new Set(days);
  const rows = new Map<string, WeekRow>();
  const emptyCells = () => Object.fromEntries(days.map((day) => [day, [] as Worklog[]]));
  for (const entry of [...worklogs].sort(byDayThenCreation)) {
    if (!dayset.has(entry.workDate)) continue;
    let row = rows.get(entry.taskId);
    if (!row) {
      row = { taskId: entry.taskId, projectId: entry.projectId, cells: emptyCells() };
      rows.set(entry.taskId, row);
    }
    row.cells[entry.workDate].push(entry);
  }
  for (const ref of extraRows) {
    if (!rows.has(ref.taskId)) rows.set(ref.taskId, { ...ref, cells: emptyCells() });
  }
  return [...rows.values()];
}

export function rowMinutes(row: WeekRow, days: readonly string[]): number {
  return days.reduce((total, day) => total + sumMinutes(row.cells[day] ?? []), 0);
}

export function dayTotals(
  rows: readonly WeekRow[],
  days: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    days.map((day) => [
      day,
      rows.reduce((total, row) => total + sumMinutes(row.cells[day] ?? []), 0),
    ]),
  );
}

/** Tasks worked on in the previous week that have no row yet, in the order they were first logged. */
export function rowsMissingFrom(
  current: readonly WeekRow[],
  previous: readonly Worklog[],
): WeekRowRef[] {
  const present = new Set(current.map((row) => row.taskId));
  const missing = new Map<string, WeekRowRef>();
  for (const entry of [...previous].sort(byDayThenCreation)) {
    if (present.has(entry.taskId) || missing.has(entry.taskId)) continue;
    missing.set(entry.taskId, { taskId: entry.taskId, projectId: entry.projectId });
  }
  return [...missing.values()];
}

export type DayStatus = "none" | "logged" | "under" | "met" | "over";

export function dayStatus(total: number, required: number): DayStatus {
  if (required <= 0) return total > 0 ? "logged" : "none";
  if (total === 0) return "none";
  if (total < required) return "under";
  return total === required ? "met" : "over";
}
