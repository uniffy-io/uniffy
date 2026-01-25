/**
 * Date utility functions for the Calendar feature
 * Uses date-fns for date manipulation
 */

import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
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
  isBefore,
  isAfter,
  differenceInMinutes,
  differenceInDays,
  getDay,
  getDate,
  getMonth,
  getYear,
  getHours,
  getMinutes,
  setHours,
  setMinutes,
  eachDayOfInterval,
} from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { DayColumn, ViewMode } from '../types';

/**
 * Get the dates for a week containing the given date
 * @param date - The reference date
 * @param weekStartsOn - Day the week starts on (0 = Sunday, 1 = Monday)
 * @returns Array of 7 dates from start to end of week
 */
export function getWeekDates(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): Date[] {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const weekStart = startOfWeek(d, { weekStartsOn });
  return eachDayOfInterval({
    start: weekStart,
    end: addDays(weekStart, 6),
  });
}

/**
 * Get DayColumn objects for a week
 */
export function getWeekColumns(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): DayColumn[] {
  const weekDates = getWeekDates(date, weekStartsOn);
  const today = new Date();

  return weekDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, 'EEE'),
    dayNumber: getDate(d),
    isToday: isSameDay(d, today),
    isCurrentMonth: isSameMonth(d, date),
    isWeekend: isWeekend(d),
    dateString: format(d, 'yyyy-MM-dd'),
  }));
}

/**
 * Get dates for a month grid (including overflow days)
 * @param date - The reference date
 * @param weekStartsOn - Day the week starts on
 * @returns Array of dates (42 days = 6 weeks)
 */
export function getMonthDates(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): Date[] {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const monthStart = startOfMonth(d);
  const monthEnd = endOfMonth(d);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });

  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

/**
 * Get DayColumn objects for a month grid
 */
export function getMonthColumns(
  date: Date | string,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): DayColumn[] {
  const monthDates = getMonthDates(date, weekStartsOn);
  const today = new Date();
  const referenceDate = typeof date === 'string' ? parseISO(date) : date;

  return monthDates.map((d) => ({
    date: d,
    dayOfWeek: getDay(d),
    dayName: format(d, 'EEE'),
    dayNumber: getDate(d),
    isToday: isSameDay(d, today),
    isCurrentMonth: isSameMonth(d, referenceDate),
    isWeekend: isWeekend(d),
    dateString: format(d, 'yyyy-MM-dd'),
  }));
}

/**
 * Format a date for display in local timezone
 */
export function formatDate(
  date: Date | string,
  formatStr: string = 'MMM d, yyyy'
): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(d, timezone, formatStr);
}

/**
 * Format a date with day of week (e.g., "Wed, Jan 22, 2026") in local timezone
 */
export function formatDateWithDay(date: Date | string): string {
  return formatDate(date, 'EEE, MMM d, yyyy');
}

/**
 * Format time for display (12-hour format) in local timezone
 */
export function formatTime(
  date: Date | string,
  use24Hour: boolean = false
): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInTimeZone(d, timezone, use24Hour ? 'HH:mm' : 'h:mm a');
}

/**
 * Format time range (e.g., "10:00 – 11:00 AM") in local timezone
 */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  use24Hour: boolean = false
): string {
  const startDate = typeof start === 'string' ? parseISO(start) : start;
  const endDate = typeof end === 'string' ? parseISO(end) : end;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (use24Hour) {
    return `${formatInTimeZone(startDate, timezone, 'HH:mm')} – ${formatInTimeZone(endDate, timezone, 'HH:mm')}`;
  }

  // Optimize for same AM/PM
  const startPeriod = formatInTimeZone(startDate, timezone, 'a');
  const endPeriod = formatInTimeZone(endDate, timezone, 'a');

  if (startPeriod === endPeriod) {
    return `${formatInTimeZone(startDate, timezone, 'h:mm')} – ${formatInTimeZone(endDate, timezone, 'h:mm a')}`;
  }

  return `${formatInTimeZone(startDate, timezone, 'h:mm a')} – ${formatInTimeZone(endDate, timezone, 'h:mm a')}`;
}

/**
 * Get month and year for header display
 */
export function formatMonthYear(date: Date | string): string {
  return formatDate(date, 'MMMM yyyy');
}

/**
 * Navigate to next/previous period based on view mode
 */
export function navigateDate(
  date: Date | string,
  direction: 'next' | 'previous',
  viewMode: ViewMode
): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const delta = direction === 'next' ? 1 : -1;

  switch (viewMode) {
    case 'day':
      return delta > 0 ? addDays(d, 1) : subDays(d, 1);
    case 'week':
      return delta > 0 ? addWeeks(d, 1) : subWeeks(d, 1);
    case 'month':
      return delta > 0 ? addMonths(d, 1) : subMonths(d, 1);
    default:
      return d;
  }
}

/**
 * Check if two dates are the same day in the local timezone.
 * Uses explicit timezone formatting to ensure correct comparison
 * for dates that may span midnight in different timezones.
 */
export function areSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === 'string' ? parseISO(date1) : date1;
  const d2 = typeof date2 === 'string' ? parseISO(date2) : date2;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Compare using local date strings to handle timezone edge cases
  const date1Local = formatInTimeZone(d1, timezone, 'yyyy-MM-dd');
  const date2Local = formatInTimeZone(d2, timezone, 'yyyy-MM-dd');
  return date1Local === date2Local;
}

/**
 * Check if a date is today
 */
export function isDateToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return isToday(d);
}

/**
 * Get start of day
 */
export function getDayStart(date: Date | string): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return startOfDay(d);
}

/**
 * Get end of day
 */
export function getDayEnd(date: Date | string): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return endOfDay(d);
}

/**
 * Calculate duration in minutes between two dates
 */
export function getDurationMinutes(
  start: Date | string,
  end: Date | string
): number {
  const startDate = typeof start === 'string' ? parseISO(start) : start;
  const endDate = typeof end === 'string' ? parseISO(end) : end;
  return differenceInMinutes(endDate, startDate);
}

/**
 * Format duration for display
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Create a date with specific time
 */
export function setTime(
  date: Date | string,
  hours: number,
  minutes: number = 0
): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return setMinutes(setHours(d, hours), minutes);
}

/**
 * Parse time string (HH:mm) to hours and minutes
 */
export function parseTimeString(time: string): { hours: number; minutes: number } {
  const [hours, minutes] = time.split(':').map(Number);
  return { hours, minutes };
}

/**
 * Convert date to ISO string (YYYY-MM-DD)
 */
export function toDateString(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'yyyy-MM-dd');
}

/**
 * Convert time to ISO string (HH:mm)
 */
export function toTimeString(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'HH:mm');
}

/**
 * Get current time info for time indicator
 */
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

/**
 * Calculate pixel position for a time within a day
 */
export function getTimePosition(
  date: Date | string,
  hourHeight: number,
  startHour: number = 0
): number {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const hours = getHours(d);
  const minutes = getMinutes(d);
  const totalMinutes = (hours - startHour) * 60 + minutes;
  return (totalMinutes / 60) * hourHeight;
}

/**
 * Calculate time from pixel position
 */
export function getTimeFromPosition(
  position: number,
  hourHeight: number,
  startHour: number = 0
): { hours: number; minutes: number } {
  const totalMinutes = (position / hourHeight) * 60;
  const hours = Math.floor(totalMinutes / 60) + startHour;
  const minutes = Math.round(totalMinutes % 60);
  return { hours, minutes };
}

/**
 * Round time to nearest interval
 */
export function roundTimeToInterval(
  date: Date | string,
  intervalMinutes: number = 15
): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const minutes = getMinutes(d);
  const roundedMinutes = Math.round(minutes / intervalMinutes) * intervalMinutes;
  return setMinutes(d, roundedMinutes);
}

/**
 * Check if an event spans multiple days
 */
export function isMultiDayEvent(
  start: Date | string,
  end: Date | string
): boolean {
  const startDate = typeof start === 'string' ? parseISO(start) : start;
  const endDate = typeof end === 'string' ? parseISO(end) : end;
  return differenceInDays(endDate, startDate) >= 1;
}

/**
 * Get date range label for header
 */
export function getDateRangeLabel(
  startDate: Date | string,
  endDate: Date | string
): string {
  const start = typeof startDate === 'string' ? parseISO(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseISO(endDate) : endDate;

  // Same month
  if (isSameMonth(start, end)) {
    return format(start, 'MMMM yyyy');
  }

  // Different months, same year
  if (getYear(start) === getYear(end)) {
    return `${format(start, 'MMM')} – ${format(end, 'MMM yyyy')}`;
  }

  // Different years
  return `${format(start, 'MMM yyyy')} – ${format(end, 'MMM yyyy')}`;
}

/**
 * Get timezone offset string (e.g., "GMT+2")
 */
export function getTimezoneOffset(timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const now = new Date();
  const formatted = formatInTimeZone(now, timezone, 'xxx');
  return `GMT${formatted.replace(':', '')}`;
}

/**
 * Convert date between timezones
 */
export function convertTimezone(
  date: Date | string,
  fromTimezone: string,
  toTimezone: string
): Date {
  const d = typeof date === 'string' ? parseISO(date) : date;
  const utcDate = fromZonedTime(d, fromTimezone);
  return toZonedTime(utcDate, toTimezone);
}

// Re-export useful date-fns functions
export {
  parseISO,
  format,
  isToday,
  isBefore,
  isAfter,
  addDays,
  addWeeks,
  addMonths,
  getHours,
  getMinutes,
  getDate,
  getMonth,
  getYear,
};
