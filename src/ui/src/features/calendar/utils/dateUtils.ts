import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  isSameDay,
  isSameMonth,
  isToday,
  isWeekend,
  differenceInMinutes,
  getDay,
  getDate,
  getYear,
  getHours,
  getMinutes,
  setHours,
  setMinutes,
  eachDayOfInterval,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { DayColumn, ViewMode } from "@/features/calendar/types";

export function getWeekDates(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
): Date[] {
  const d = typeof date === "string" ? parseISO(date) : date;
  const weekStart = startOfWeek(d, { weekStartsOn });
  return eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6),
  });
}

export function getWeekColumns(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
): DayColumn[] {
  const weekDates = getWeekDates(date, weekStartsOn);
  const today = new Date();

  return weekDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, "EEE"),
    dayNumber: getDate(d),
    isToday: isSameDay(d, today),
    isCurrentMonth: isSameMonth(d, date),
    isWeekend: isWeekend(d),
    dateString: format(d, "yyyy-MM-dd"),
  }));
}

/** Always returns 42 dates (6 weeks) including overflow from prev/next month. */
function getMonthDates(date: Date | string, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1): Date[] {
  const d = typeof date === "string" ? parseISO(date) : date;
  const monthStart = startOfMonth(d);
  const monthEnd = endOfMonth(d);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });

  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

export function getMonthColumns(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1,
): DayColumn[] {
  const monthDates = getMonthDates(date, weekStartsOn);
  const today = new Date();
  const referenceDate = typeof date === "string" ? parseISO(date) : date;

  return monthDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, "EEE"),
    dayNumber: getDate(d),
    isToday: isSameDay(d, today),
    isCurrentMonth: isSameMonth(d, referenceDate),
    isWeekend: isWeekend(d),
    dateString: format(d, "yyyy-MM-dd"),
  }));
}

/** Renders in the browser's local timezone (events are stored UTC). */
export function formatDate(date: Date | string, formatStr: string = "MMM d, yyyy"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(d, timezone, formatStr);
}

export function formatDateWithDay(date: Date | string): string {
  return formatDate(date, "EEE, MMM d, yyyy");
}

export function formatTime(date: Date | string, use24Hour: boolean = false): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(d, timezone, use24Hour ? "HH:mm" : "h:mm a");
}

export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  use24Hour: boolean = false,
): string {
  const startDate = typeof start === "string" ? parseISO(start) : start;
  const endDate = typeof end === "string" ? parseISO(end) : end;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (use24Hour) {
    return `${formatInTimeZone(startDate, timezone, "HH:mm")} – ${formatInTimeZone(endDate, timezone, "HH:mm")}`;
  }

  // Collapse the AM/PM on the start side when both fall in the same period.
  const startPeriod = formatInTimeZone(startDate, timezone, "a");
  const endPeriod = formatInTimeZone(endDate, timezone, "a");

  if (startPeriod === endPeriod) {
    return `${formatInTimeZone(startDate, timezone, "h:mm")} – ${formatInTimeZone(endDate, timezone, "h:mm a")}`;
  }

  return `${formatInTimeZone(startDate, timezone, "h:mm a")} – ${formatInTimeZone(endDate, timezone, "h:mm a")}`;
}

export function formatMonthYear(date: Date | string): string {
  return formatDate(date, "MMMM yyyy");
}

export function navigateDate(
  date: Date | string,
  direction: "next" | "previous",
  viewMode: ViewMode,
): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  const delta = direction === "next" ? 1 : -1;

  switch (viewMode) {
    case "day":
      return delta > 0 ? addDays(d, 1) : subDays(d, 1);
    case "week":
      return delta > 0 ? addWeeks(d, 1) : subWeeks(d, 1);
    case "month":
      return delta > 0 ? addMonths(d, 1) : subMonths(d, 1);
    default:
      return d;
  }
}

/** Compares yyyy-MM-dd in the local zone so DST and UTC-midnight events do not get mis-bucketed. */
export function areSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === "string" ? parseISO(date1) : date1;
  const d2 = typeof date2 === "string" ? parseISO(date2) : date2;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date1Local = formatInTimeZone(d1, timezone, "yyyy-MM-dd");
  const date2Local = formatInTimeZone(d2, timezone, "yyyy-MM-dd");
  return date1Local === date2Local;
}

export function isDateToday(date: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  return isToday(d);
}

export function getDurationMinutes(start: Date | string, end: Date | string): number {
  const startDate = typeof start === "string" ? parseISO(start) : start;
  const endDate = typeof end === "string" ? parseISO(end) : end;
  return differenceInMinutes(endDate, startDate);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

export function setTime(date: Date | string, hours: number, minutes: number = 0): Date {
  const d = typeof date === "string" ? parseISO(date) : date;
  return setMinutes(setHours(d, hours), minutes);
}

/** Parses 'HH:mm'. */
export function parseTimeString(time: string): { hours: number; minutes: number } {
  const [hours, minutes] = time.split(":").map(Number);
  return { hours, minutes };
}

export function toDateString(date: Date | string): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "yyyy-MM-dd");
}

export function getCurrentTimeInfo(): {
  hour: number;
  minutes: number;
  percentOfHour: number;
} {
  const now = new Date();
  const hour = getHours(now);
  const minutes = getMinutes(now);
  return {
    hour,
    minutes,
    percentOfHour: minutes / 60,
  };
}

export function getDateRangeLabel(startDate: Date | string, endDate: Date | string): string {
  const start = typeof startDate === "string" ? parseISO(startDate) : startDate;
  const end = typeof endDate === "string" ? parseISO(endDate) : endDate;

  if (isSameMonth(start, end)) {
    return format(start, "MMMM yyyy");
  }

  if (getYear(start) === getYear(end)) {
    return `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`;
  }

  return `${format(start, "MMM yyyy")} – ${format(end, "MMM yyyy")}`;
}

export function getTimezoneOffset(
  timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const now = new Date();
  const formatted = formatInTimeZone(now, timezone, "xxx");
  return `GMT${formatted.replace(":", "")}`;
}

export { parseISO, format, addMonths };
