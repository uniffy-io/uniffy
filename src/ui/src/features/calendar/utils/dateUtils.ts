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
  isSameMonth,
  isWeekend,
  differenceInMinutes,
  getDay,
  getDate,
  getYear,
  setHours,
  setMinutes,
  eachDayOfInterval,
} from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { getWeekStartsOn } from "@/shared/utils/weekStart";
import type { DayColumn, ViewMode } from "@/features/calendar/types";

export function getWeekDates(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = getWeekStartsOn(),
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
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = getWeekStartsOn(),
): DayColumn[] {
  const weekDates = getWeekDates(date, weekStartsOn);
  const todayKey = instantDayKey(new Date());

  return weekDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, "EEE"),
    dayNumber: getDate(d),
    isToday: format(d, "yyyy-MM-dd") === todayKey,
    isCurrentMonth: isSameMonth(d, date),
    isWeekend: isWeekend(d),
    dateString: format(d, "yyyy-MM-dd"),
  }));
}

/** Always returns 42 dates (6 weeks) including overflow from prev/next month. */
function getMonthDates(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = getWeekStartsOn(),
): Date[] {
  const d = typeof date === "string" ? parseISO(date) : date;
  const monthStart = startOfMonth(d);
  const monthEnd = endOfMonth(d);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });

  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

export function getMonthColumns(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = getWeekStartsOn(),
): DayColumn[] {
  const monthDates = getMonthDates(date, weekStartsOn);
  const todayKey = instantDayKey(new Date());
  const referenceDate = typeof date === "string" ? parseISO(date) : date;

  return monthDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, "EEE"),
    dayNumber: getDate(d),
    isToday: format(d, "yyyy-MM-dd") === todayKey,
    isCurrentMonth: isSameMonth(d, referenceDate),
    isWeekend: isWeekend(d),
    dateString: format(d, "yyyy-MM-dd"),
  }));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Renders in the user's display timezone (events are stored UTC).
 *
 * Date-only strings and Date objects are CALENDAR values (day keys, grid
 * column tokens) - their own year/month/day already name the day, so they
 * render as-is. Only ISO strings with a time component are instants that
 * convert through the display zone.
 */
export function formatDate(date: Date | string, formatStr: string = "MMM d, yyyy"): string {
  if (typeof date === "string" && !DATE_ONLY.test(date)) {
    return formatInTimeZone(parseISO(date), getEffectiveTimeZone(), formatStr);
  }
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, formatStr);
}

export function formatDateWithDay(date: Date | string): string {
  return formatDate(date, "EEE, MMM d, yyyy");
}

export function formatTime(date: Date | string, use24Hour: boolean = false): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return formatInTimeZone(d, getEffectiveTimeZone(), use24Hour ? "HH:mm" : "h:mm a");
}

export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  use24Hour: boolean = false,
): string {
  const startDate = typeof start === "string" ? parseISO(start) : start;
  const endDate = typeof end === "string" ? parseISO(end) : end;
  const timezone = getEffectiveTimeZone();

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

/**
 * Display-zone calendar day of a value. Date-only strings and Date tokens
 * (grid columns, day keys) already name their day; ISO instants convert
 * through the display zone.
 */
export function displayDayKey(value: Date | string): string {
  if (typeof value === "string") {
    if (DATE_ONLY.test(value)) return value;
    return formatInTimeZone(parseISO(value), getEffectiveTimeZone(), "yyyy-MM-dd");
  }
  return format(value, "yyyy-MM-dd");
}

/** Display-zone calendar day containing an instant. */
export function instantDayKey(instant: Date | string): string {
  const d = typeof instant === "string" ? parseISO(instant) : instant;
  return formatInTimeZone(d, getEffectiveTimeZone(), "yyyy-MM-dd");
}

/** Compares display-zone yyyy-MM-dd so DST and UTC-midnight events do not get mis-bucketed. */
export function areSameDay(date1: Date | string, date2: Date | string): boolean {
  return displayDayKey(date1) === displayDayKey(date2);
}

export function isDateToday(date: Date | string): boolean {
  return displayDayKey(date) === instantDayKey(new Date());
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

/**
 * The instant at a wall-clock time on a calendar day, read in the DISPLAY
 * zone. Grid clicks, drops and time pickers all mean "this hour on the
 * clock the grid renders", which is not the device clock when a timezone
 * preference is set.
 */
export function instantFromDisplayParts(day: Date | string, hours: number, minutes: number): Date {
  const d = typeof day === "string" ? parseISO(day) : day;
  const wall = `${format(d, "yyyy-MM-dd")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  return fromZonedTime(wall, getEffectiveTimeZone());
}

/** Wall-clock parts of an instant on the display zone's clock. */
export function displayParts(instant: Date | string): {
  hours: number;
  minutes: number;
} {
  const d = typeof instant === "string" ? parseISO(instant) : instant;
  const zone = getEffectiveTimeZone();
  return {
    hours: Number(formatInTimeZone(d, zone, "H")),
    minutes: Number(formatInTimeZone(d, zone, "m")),
  };
}

export function getCurrentTimeInfo(): {
  hour: number;
  minutes: number;
  percentOfHour: number;
} {
  // The now-line sits on the display zone's clock, not the device clock.
  const now = new Date();
  const zone = getEffectiveTimeZone();
  const hour = Number(formatInTimeZone(now, zone, "H"));
  const minutes = Number(formatInTimeZone(now, zone, "m"));
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

export function getTimezoneOffset(timezone: string = getEffectiveTimeZone()): string {
  const now = new Date();
  const formatted = formatInTimeZone(now, timezone, "xxx");
  return `GMT${formatted.replace(":", "")}`;
}

export { parseISO, format, addMonths };
