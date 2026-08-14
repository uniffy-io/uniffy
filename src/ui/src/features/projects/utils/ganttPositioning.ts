import {
  differenceInDays,
  getDaysInMonth,
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

export const COLUMN_WIDTHS: Record<ZoomLevel, number> = {
  day: 40,
  week: 120,
  month: 200,
};

export function getStartOfPeriod(date: Date, zoom: ZoomLevel): Date {
  switch (zoom) {
    case "day":
      return startOfDay(date);
    case "week":
      return startOfWeek(date, { weekStartsOn: 1 });
    case "month":
      return startOfMonth(date);
  }
}

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

export function getDifferenceInPeriods(startDate: Date, endDate: Date, zoom: ZoomLevel): number {
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

export function formatMonthLabel(date: Date): string {
  return format(date, "MMMM yyyy");
}

const DAYS_PER_COLUMN: Record<ZoomLevel, number> = {
  day: 1,
  week: 7,
  month: 30.44,
};

const MIN_BAR_WIDTH = 20;

/** Month zoom uses fractional day-in-month to align bars across variable month lengths. */
export function dateToPixelX(date: Date, viewStartDate: Date, zoom: ZoomLevel): number {
  const columnWidth = COLUMN_WIDTHS[zoom];

  if (zoom === "month") {
    const monthsDiff =
      (date.getFullYear() - viewStartDate.getFullYear()) * 12 +
      (date.getMonth() - viewStartDate.getMonth());
    const dayInMonth = date.getDate() - 1;
    const daysInMonth = getDaysInMonth(date);
    return (monthsDiff + dayInMonth / daysInMonth) * columnWidth;
  }

  const pixelsPerDay = columnWidth / DAYS_PER_COLUMN[zoom];
  return differenceInDays(date, viewStartDate) * pixelsPerDay;
}

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
  zoom: ZoomLevel,
): GanttBarPosition | null {
  if (!taskStartDate || !taskEndDate) {
    return null;
  }

  const start = parseISO(taskStartDate);
  const end = parseISO(taskEndDate);

  if (isAfter(start, viewEndDate) || isBefore(end, viewStartDate)) {
    return null;
  }

  const visibleStart = isBefore(start, viewStartDate) ? viewStartDate : start;
  const visibleEnd = isAfter(end, viewEndDate) ? viewEndDate : end;

  const left = dateToPixelX(visibleStart, viewStartDate, zoom);
  const endX = dateToPixelX(addDays(visibleEnd, 1), viewStartDate, zoom);
  // Keep a minimum width so a 1-day bar stays clickable at month zoom.
  const width = Math.max(endX - left, MIN_BAR_WIDTH);

  return {
    left,
    width,
    isPartialStart: isBefore(start, viewStartDate),
    isPartialEnd: isAfter(end, viewEndDate),
  };
}

export function pixelToDate(pixelX: number, viewStartDate: Date, zoom: ZoomLevel): Date {
  const columnWidth = COLUMN_WIDTHS[zoom];

  if (zoom === "month") {
    const monthIndex = pixelX / columnWidth;
    const wholeMonths = Math.floor(monthIndex);
    const fraction = monthIndex - wholeMonths;
    const targetMonth = addMonths(viewStartDate, wholeMonths);
    const daysInMonth = getDaysInMonth(targetMonth);
    const dayOffset = Math.round(fraction * daysInMonth);
    return addDays(targetMonth, dayOffset);
  }

  const pixelsPerDay = columnWidth / DAYS_PER_COLUMN[zoom];
  const dayOffset = Math.round(pixelX / pixelsPerDay);
  return addDays(viewStartDate, dayOffset);
}

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
  zoom: ZoomLevel,
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

export function calculateVisibleRange(
  scrollLeft: number,
  containerWidth: number,
  zoom: ZoomLevel,
  baseDate: Date,
): { start: Date; end: Date } {
  const columnWidth = COLUMN_WIDTHS[zoom];
  const startOffset = Math.floor(scrollLeft / columnWidth);
  const visibleColumns = Math.ceil(containerWidth / columnWidth) + 1;

  return {
    start: addPeriods(baseDate, startOffset, zoom),
    end: addPeriods(baseDate, startOffset + visibleColumns, zoom),
  };
}

export function isTaskVisible(
  taskStartDate: string | null,
  taskEndDate: string | null,
  viewStartDate: Date,
  viewEndDate: Date,
): boolean {
  if (!taskStartDate && !taskEndDate) {
    return false;
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

  if (taskStartDate && taskEndDate) {
    const start = parseISO(taskStartDate);
    const end = parseISO(taskEndDate);
    if (isBefore(start, viewStartDate) && isAfter(end, viewEndDate)) {
      return true;
    }
  }

  return false;
}
