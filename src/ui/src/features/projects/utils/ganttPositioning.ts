/**
 * Utility functions for Gantt/Roadmap view positioning
 */

import {
  differenceInDays,
  startOfDay,
  startOfWeek,
  startOfMonth,
  addDays,
  addWeeks,
  addMonths,
  format,
  isWithinInterval,
  isBefore,
  isAfter,
  parseISO,
} from "date-fns";

export type ZoomLevel = "day" | "week" | "month";

/**
 * Column width in pixels for each zoom level
 */
export const COLUMN_WIDTHS: Record<ZoomLevel, number> = {
  day: 40,
  week: 120,
  month: 200,
};

/**
 * Get the start of period based on zoom level
 */
export function getStartOfPeriod(date: Date, zoom: ZoomLevel): Date {
  switch (zoom) {
    case "day":
      return startOfDay(date);
    case "week":
      return startOfWeek(date, { weekStartsOn: 1 }); // Monday start
    case "month":
      return startOfMonth(date);
  }
}

/**
 * Add periods based on zoom level
 */
export function addPeriods(date: Date, count: number, zoom: ZoomLevel): Date {
  switch (zoom) {
    case "day":
      return addDays(date, count);
    case "week":
      return addWeeks(date, count);
    case "month":
      return addMonths(date, count);
  }
}

/**
 * Get the difference in periods between two dates
 */
export function getDifferenceInPeriods(
  startDate: Date,
  endDate: Date,
  zoom: ZoomLevel
): number {
  const days = differenceInDays(endDate, startDate);
  switch (zoom) {
    case "day":
      return days;
    case "week":
      return Math.floor(days / 7);
    case "month":
      return Math.round(days / 30);
  }
}

/**
 * Format date header label based on zoom level
 */
export function formatPeriodLabel(date: Date, zoom: ZoomLevel): string {
  switch (zoom) {
    case "day":
      return format(date, "d");
    case "week":
      return format(date, "MMM d");
    case "month":
      return format(date, "MMM");
  }
}

/**
 * Format month header label
 */
export function formatMonthLabel(date: Date): string {
  return format(date, "MMMM yyyy");
}

/**
 * Days per column for each zoom level (used for proportional positioning)
 */
const DAYS_PER_COLUMN: Record<ZoomLevel, number> = {
  day: 1,
  week: 7,
  month: 30.44,
};

/**
 * Calculate gantt bar position and width.
 *
 * Uses day-based math for all zoom levels so bars align accurately
 * within columns instead of snapping to column boundaries.
 */
export interface GanttBarPosition {
  left: number;
  width: number;
  isPartialStart: boolean;
  isPartialEnd: boolean;
}

export function calculateBarPosition(
  taskStartDate: string | null,
  taskEndDate: string | null,
  viewStartDate: Date,
  viewEndDate: Date,
  zoom: ZoomLevel
): GanttBarPosition | null {
  if (!taskStartDate || !taskEndDate) {
    return null;
  }

  const start = parseISO(taskStartDate);
  const end = parseISO(taskEndDate);

  // Task is completely outside the view
  if (isAfter(start, viewEndDate) || isBefore(end, viewStartDate)) {
    return null;
  }

  // Determine actual visible start and end
  const visibleStart = isBefore(start, viewStartDate) ? viewStartDate : start;
  const visibleEnd = isAfter(end, viewEndDate) ? viewEndDate : end;

  // Use day-based calculations for accurate sub-column positioning
  const columnWidth = COLUMN_WIDTHS[zoom];
  const pixelsPerDay = columnWidth / DAYS_PER_COLUMN[zoom];

  const startDayOffset = differenceInDays(visibleStart, viewStartDate);
  const durationDays = differenceInDays(visibleEnd, visibleStart) + 1;

  const left = startDayOffset * pixelsPerDay;
  const width = Math.max(durationDays * pixelsPerDay, columnWidth * 0.5);

  return {
    left,
    width,
    isPartialStart: isBefore(start, viewStartDate),
    isPartialEnd: isAfter(end, viewEndDate),
  };
}

/**
 * Convert a pixel X position back to a date (inverse of bar positioning).
 */
export function pixelToDate(
  pixelX: number,
  viewStartDate: Date,
  zoom: ZoomLevel
): Date {
  const columnWidth = COLUMN_WIDTHS[zoom];
  const pixelsPerDay = columnWidth / DAYS_PER_COLUMN[zoom];
  const dayOffset = Math.round(pixelX / pixelsPerDay);
  return addDays(viewStartDate, dayOffset);
}

/**
 * Generate column data for timeline header
 */
export interface TimelineColumn {
  date: Date;
  label: string;
  isToday: boolean;
  isWeekend: boolean;
  monthLabel?: string;
  isFirstOfMonth: boolean;
  yearLabel?: string;
  isFirstOfYear: boolean;
}

export function generateTimelineColumns(
  startDate: Date,
  endDate: Date,
  zoom: ZoomLevel
): TimelineColumn[] {
  const columns: TimelineColumn[] = [];
  const today = startOfDay(new Date());
  let currentDate = getStartOfPeriod(startDate, zoom);
  let lastMonth = -1;
  let lastYear = -1;

  while (isBefore(currentDate, endDate) || currentDate.getTime() === endDate.getTime()) {
    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday = currentDate.getTime() === today.getTime();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    const isFirstOfMonth = currentMonth !== lastMonth;
    const isFirstOfYear = currentYear !== lastYear;

    columns.push({
      date: currentDate,
      label: formatPeriodLabel(currentDate, zoom),
      isToday,
      isWeekend,
      monthLabel: isFirstOfMonth ? formatMonthLabel(currentDate) : undefined,
      isFirstOfMonth,
      yearLabel: isFirstOfYear ? String(currentYear) : undefined,
      isFirstOfYear,
    });

    lastMonth = currentMonth;
    lastYear = currentYear;
    currentDate = addPeriods(currentDate, 1, zoom);
  }

  return columns;
}

/**
 * Calculate visible date range based on scroll position
 */
export function calculateVisibleRange(
  scrollLeft: number,
  containerWidth: number,
  zoom: ZoomLevel,
  baseDate: Date
): { start: Date; end: Date } {
  const columnWidth = COLUMN_WIDTHS[zoom];
  const startOffset = Math.floor(scrollLeft / columnWidth);
  const visibleColumns = Math.ceil(containerWidth / columnWidth) + 1;

  return {
    start: addPeriods(baseDate, startOffset, zoom),
    end: addPeriods(baseDate, startOffset + visibleColumns, zoom),
  };
}

/**
 * Check if a task is within the visible date range
 */
export function isTaskVisible(
  taskStartDate: string | null,
  taskEndDate: string | null,
  viewStartDate: Date,
  viewEndDate: Date
): boolean {
  if (!taskStartDate && !taskEndDate) {
    return false; // No dates, not visible in roadmap
  }

  const interval = { start: viewStartDate, end: viewEndDate };

  if (taskStartDate) {
    const start = parseISO(taskStartDate);
    if (isWithinInterval(start, interval)) return true;
  }

  if (taskEndDate) {
    const end = parseISO(taskEndDate);
    if (isWithinInterval(end, interval)) return true;
  }

  // Check if task spans the entire view
  if (taskStartDate && taskEndDate) {
    const start = parseISO(taskStartDate);
    const end = parseISO(taskEndDate);
    if (isBefore(start, viewStartDate) && isAfter(end, viewEndDate)) {
      return true;
    }
  }

  return false;
}
