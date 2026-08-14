import type { CalendarEvent, PositionedEvent, MultiDayPosition } from "@/features/calendar/types";
import { GRID } from "@/features/calendar/constants";
import { parseISO, getDurationMinutes, format } from "@/features/calendar/utils/dateUtils";
import { formatInTimeZone } from "date-fns-tz";

const getLocalTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/** Read clock hours/minutes in the browser's local zone (events are stored UTC). */
function getLocalHoursMinutes(isoString: string): { hours: number; minutes: number } {
  const date = parseISO(isoString);
  const timezone = getLocalTimezone();
  const hours = parseInt(formatInTimeZone(date, timezone, "H"), 10);
  const minutes = parseInt(formatInTimeZone(date, timezone, "m"), 10);

  return { hours, minutes };
}

/** yyyy-MM-dd in the local zone so events do not drift to the UTC date. */
function getLocalDateString(isoString: string): string {
  const date = parseISO(isoString);
  const timezone = getLocalTimezone();
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

/** Multi-day events repeat the same hour band on each day; geometry uses local clock-time only. */
function calculateEventPosition(
  event: CalendarEvent,
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compatibility
  _renderDate?: Date | string,
): { top: number; height: number } {
  const { hours: effectiveStartHour, minutes: effectiveStartMinutes } = getLocalHoursMinutes(
    event.startTime,
  );
  const { hours: effectiveEndHour, minutes: effectiveEndMinutes } = getLocalHoursMinutes(
    event.endTime,
  );

  const minutesFromStart = (effectiveStartHour - startHour) * 60 + effectiveStartMinutes;
  const top = (minutesFromStart / 60) * hourHeight;

  const effectiveDurationMinutes =
    (effectiveEndHour - effectiveStartHour) * 60 + (effectiveEndMinutes - effectiveStartMinutes);
  const height = Math.max((effectiveDurationMinutes / 60) * hourHeight, GRID.MIN_EVENT_HEIGHT);

  return { top, height };
}

function eventsOverlap(event1: CalendarEvent, event2: CalendarEvent): boolean {
  const start1 = parseISO(event1.startTime);
  const end1 = parseISO(event1.endTime);
  const start2 = parseISO(event2.startTime);
  const end2 = parseISO(event2.endTime);

  return start1 < end2 && start2 < end1;
}

function groupOverlappingEvents(events: CalendarEvent[]): CalendarEvent[][] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime(),
  );

  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const event = sorted[i];
    const overlapsWithGroup = currentGroup.some((groupEvent) => eventsOverlap(event, groupEvent));

    if (overlapsWithGroup) {
      currentGroup.push(event);
    } else {
      groups.push(currentGroup);
      currentGroup = [event];
    }
  }

  groups.push(currentGroup);
  return groups;
}

/** Greedy column packing - longer events first to minimize total columns. */
function assignEventColumns(
  events: CalendarEvent[],
): { event: CalendarEvent; column: number; totalColumns: number }[] {
  if (events.length === 0) return [];
  if (events.length === 1) {
    return [{ event: events[0], column: 0, totalColumns: 1 }];
  }

  const sorted = [...events].sort((a, b) => {
    const startDiff = parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime();
    if (startDiff !== 0) return startDiff;
    return getDurationMinutes(b.startTime, b.endTime) - getDurationMinutes(a.startTime, a.endTime);
  });

  const assignments: { event: CalendarEvent; column: number }[] = [];
  const columnEndTimes: Date[] = [];

  for (const event of sorted) {
    const eventStart = parseISO(event.startTime);

    let column = 0;
    while (column < columnEndTimes.length) {
      if (columnEndTimes[column] <= eventStart) {
        break;
      }
      column++;
    }

    assignments.push({ event, column });

    const eventEnd = parseISO(event.endTime);
    if (column < columnEndTimes.length) {
      columnEndTimes[column] = eventEnd;
    } else {
      columnEndTimes.push(eventEnd);
    }
  }

  const totalColumns = columnEndTimes.length;

  return assignments.map(({ event, column }) => ({
    event,
    column,
    totalColumns,
  }));
}

function eventSpansDate(event: CalendarEvent, date: Date | string): boolean {
  const targetDate = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  const targetDateStr = format(targetDate, "yyyy-MM-dd");

  const eventStartDateStr = getLocalDateString(event.startTime);
  const eventEndDateStr = getLocalDateString(event.endTime);

  return eventStartDateStr <= targetDateStr && targetDateStr <= eventEndDateStr;
}

function getMultiDayPosition(event: CalendarEvent, date: Date | string): MultiDayPosition {
  const targetDate = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  const targetDateStr = format(targetDate, "yyyy-MM-dd");

  const eventStartDateStr = getLocalDateString(event.startTime);
  const eventEndDateStr = getLocalDateString(event.endTime);

  if (eventStartDateStr === eventEndDateStr) {
    return "single";
  }

  if (targetDateStr === eventStartDateStr) {
    return "start";
  } else if (targetDateStr === eventEndDateStr) {
    return "end";
  } else {
    return "middle";
  }
}

export function findConflicts(event: CalendarEvent, allEvents: CalendarEvent[]): CalendarEvent[] {
  return allEvents.filter((other) => other.id !== event.id && eventsOverlap(event, other));
}

/** Includes events that span into this day, not just those that start on it. */
export function getPositionedEventsForDay(
  events: CalendarEvent[],
  date: Date | string,
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT,
  columnWidth: number = 100,
): PositionedEvent[] {
  // All-day events render in a separate row.
  const dayEvents = events.filter((e) => !e.isAllDay && eventSpansDate(e, date));

  if (dayEvents.length === 0) return [];

  const groups = groupOverlappingEvents(dayEvents);

  const positionedEvents: PositionedEvent[] = [];

  for (const group of groups) {
    const assignments = assignEventColumns(group);

    for (const { event, column, totalColumns } of assignments) {
      const { top, height } = calculateEventPosition(event, startHour, hourHeight, date);

      // Gap only when there is more than one column so single events fill the day cell.
      const gapPercent = totalColumns > 1 ? GRID.EVENT_GAP / totalColumns : 0;
      const widthPercent = columnWidth / totalColumns - gapPercent;
      const leftPercent = (column / totalColumns) * columnWidth + (column > 0 ? gapPercent / 2 : 0);

      const multiDayPosition = getMultiDayPosition(event, date);

      const conflicts = group.filter((e) => e.id !== event.id);
      const hasConflict = conflicts.length > 0;

      positionedEvents.push({
        ...event,
        top,
        height,
        left: leftPercent / 100,
        width: widthPercent / 100,
        column,
        totalColumns,
        multiDayPosition,
        hasConflict,
        conflictingEvents: conflicts,
      });
    }
  }

  return positionedEvents;
}

export function getPositionedEventsForWeek(
  events: CalendarEvent[],
  weekDates: Date[],
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT,
): Map<string, PositionedEvent[]> {
  const result = new Map<string, PositionedEvent[]>();

  for (const date of weekDates) {
    // Key matches dateString from weekColumns (local zone).
    const dateKey = format(date, "yyyy-MM-dd");
    const dayEvents = getPositionedEventsForDay(events, date, startHour, hourHeight);
    result.set(dateKey, dayEvents);
  }

  return result;
}

/** Packs all-day events into the top row with one event per (row, day) cell. */
export function positionAllDayEvents(
  events: CalendarEvent[],
  weekDates: Date[],
): {
  event: CalendarEvent;
  startColumn: number;
  spanColumns: number;
  row: number;
}[] {
  const allDayEvents = events.filter((e) => e.isAllDay);

  if (allDayEvents.length === 0) return [];

  const dateToColumn = new Map<string, number>();
  weekDates.forEach((date, index) => {
    dateToColumn.set(format(date, "yyyy-MM-dd"), index);
  });

  // Longer spans first so they claim contiguous cells before shorter events fill the gaps.
  const sorted = [...allDayEvents].sort((a, b) => {
    const startDiff = parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime();
    if (startDiff !== 0) return startDiff;

    const spanA = getDurationMinutes(a.startTime, a.endTime);
    const spanB = getDurationMinutes(b.startTime, b.endTime);
    return spanB - spanA;
  });

  const positions: {
    event: CalendarEvent;
    startColumn: number;
    spanColumns: number;
    row: number;
  }[] = [];

  // row -> set of occupied column indices.
  const occupiedCells: Set<string>[] = [];

  for (const event of sorted) {
    const startKey = getLocalDateString(event.startTime);
    const endKey = getLocalDateString(event.endTime);

    const startColumn = dateToColumn.get(startKey) ?? 0;
    const endColumn = dateToColumn.get(endKey) ?? weekDates.length - 1;
    const spanColumns = Math.min(endColumn - startColumn + 1, weekDates.length);

    let row = 0;
    let foundRow = false;

    while (!foundRow) {
      if (!occupiedCells[row]) {
        occupiedCells[row] = new Set();
      }

      let available = true;
      for (let col = startColumn; col < startColumn + spanColumns; col++) {
        if (occupiedCells[row].has(col.toString())) {
          available = false;
          break;
        }
      }

      if (available) {
        foundRow = true;
        for (let col = startColumn; col < startColumn + spanColumns; col++) {
          occupiedCells[row].add(col.toString());
        }
      } else {
        row++;
      }
    }

    positions.push({
      event,
      startColumn,
      spanColumns,
      row,
    });
  }

  return positions;
}
