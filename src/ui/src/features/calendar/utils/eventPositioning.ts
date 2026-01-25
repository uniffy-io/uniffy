/**
 * Event positioning utilities for the Calendar grid
 * Handles event block placement, overlap detection, and sizing
 */

import type { CalendarEvent, PositionedEvent } from '../types';
import { GRID } from '../constants';
import { parseISO, getDurationMinutes, areSameDay, format } from './dateUtils';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Get the browser's local timezone
 */
const getLocalTimezone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Get hours and minutes from an ISO string in the local timezone.
 * Uses formatInTimeZone to explicitly extract time in the browser's timezone.
 */
function getLocalHoursMinutes(isoString: string): { hours: number; minutes: number } {
  const date = parseISO(isoString);
  const timezone = getLocalTimezone();
  const hours = parseInt(formatInTimeZone(date, timezone, 'H'), 10);
  const minutes = parseInt(formatInTimeZone(date, timezone, 'm'), 10);

  return { hours, minutes };
}

/**
 * Get the local date string (yyyy-MM-dd) from an ISO timestamp.
 * This ensures we use the local date, not UTC date, for event placement.
 */
function getLocalDateString(isoString: string): string {
  const date = parseISO(isoString);
  const timezone = getLocalTimezone();
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

/**
 * Calculate the top position and height for an event block
 */
export function calculateEventPosition(
  event: CalendarEvent,
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT
): { top: number; height: number } {
  // Get hours and minutes in the local timezone for correct positioning
  const { hours: startHourOfDay, minutes: startMinutes } = getLocalHoursMinutes(event.startTime);
  const durationMinutes = getDurationMinutes(event.startTime, event.endTime);

  // Calculate top position from start of visible grid
  const minutesFromStart = (startHourOfDay - startHour) * 60 + startMinutes;
  const top = (minutesFromStart / 60) * hourHeight;

  // Calculate height from duration
  const height = Math.max(
    (durationMinutes / 60) * hourHeight,
    GRID.MIN_EVENT_HEIGHT
  );

  return { top, height };
}

/**
 * Check if two events overlap in time
 */
export function eventsOverlap(event1: CalendarEvent, event2: CalendarEvent): boolean {
  const start1 = parseISO(event1.startTime);
  const end1 = parseISO(event1.endTime);
  const start2 = parseISO(event2.startTime);
  const end2 = parseISO(event2.endTime);

  // Events overlap if one starts before the other ends
  return start1 < end2 && start2 < end1;
}

/**
 * Group overlapping events together
 */
export function groupOverlappingEvents(events: CalendarEvent[]): CalendarEvent[][] {
  if (events.length === 0) return [];

  // Sort events by start time
  const sorted = [...events].sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime()
  );

  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const event = sorted[i];
    const overlapsWithGroup = currentGroup.some((groupEvent) =>
      eventsOverlap(event, groupEvent)
    );

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

/**
 * Assign columns to overlapping events
 * Uses a greedy algorithm to minimize total columns needed
 */
export function assignEventColumns(
  events: CalendarEvent[]
): { event: CalendarEvent; column: number; totalColumns: number }[] {
  if (events.length === 0) return [];
  if (events.length === 1) {
    return [{ event: events[0], column: 0, totalColumns: 1 }];
  }

  // Sort by start time, then by duration (longer events first)
  const sorted = [...events].sort((a, b) => {
    const startDiff =
      parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime();
    if (startDiff !== 0) return startDiff;
    return getDurationMinutes(b.startTime, b.endTime) -
           getDurationMinutes(a.startTime, a.endTime);
  });

  const assignments: { event: CalendarEvent; column: number }[] = [];
  const columnEndTimes: Date[] = [];

  for (const event of sorted) {
    const eventStart = parseISO(event.startTime);

    // Find the first available column
    let column = 0;
    while (column < columnEndTimes.length) {
      if (columnEndTimes[column] <= eventStart) {
        break;
      }
      column++;
    }

    // Assign event to this column
    assignments.push({ event, column });

    // Update or add column end time
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

/**
 * Get positioned events for a single day
 */
export function getPositionedEventsForDay(
  events: CalendarEvent[],
  date: Date | string,
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT,
  columnWidth: number = 100 // percentage
): PositionedEvent[] {
  // Filter events for this day
  const dayEvents = events.filter((event) =>
    areSameDay(event.startTime, date)
  );

  if (dayEvents.length === 0) return [];

  // Group overlapping events
  const groups = groupOverlappingEvents(dayEvents);

  const positionedEvents: PositionedEvent[] = [];

  for (const group of groups) {
    const assignments = assignEventColumns(group);

    for (const { event, column, totalColumns } of assignments) {
      const { top, height } = calculateEventPosition(event, startHour, hourHeight);

      // Calculate horizontal position and width
      // Only apply small gap between overlapping events, single events fill full width
      const gapPercent = totalColumns > 1 ? GRID.EVENT_GAP / totalColumns : 0;
      const widthPercent = (columnWidth / totalColumns) - gapPercent;
      const leftPercent = (column / totalColumns) * columnWidth + (column > 0 ? gapPercent / 2 : 0);

      positionedEvents.push({
        ...event,
        top,
        height,
        left: leftPercent / 100,
        width: widthPercent / 100,
        column,
        totalColumns,
      });
    }
  }

  return positionedEvents;
}

/**
 * Get all positioned events for a week
 */
export function getPositionedEventsForWeek(
  events: CalendarEvent[],
  weekDates: Date[],
  startHour: number = GRID.START_HOUR,
  hourHeight: number = GRID.HOUR_HEIGHT
): Map<string, PositionedEvent[]> {
  const result = new Map<string, PositionedEvent[]>();

  for (const date of weekDates) {
    // Use local date format to match dateString from weekColumns
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayEvents = getPositionedEventsForDay(
      events,
      date,
      startHour,
      hourHeight
    );
    result.set(dateKey, dayEvents);
  }

  return result;
}

/**
 * Calculate event position for all-day events
 * All-day events are displayed in a separate row at the top
 */
export function positionAllDayEvents(
  events: CalendarEvent[],
  weekDates: Date[]
): {
  event: CalendarEvent;
  startColumn: number;
  spanColumns: number;
  row: number;
}[] {
  const allDayEvents = events.filter((e) => e.isAllDay);

  if (allDayEvents.length === 0) return [];

  // Create date-to-column mapping using local dates
  const dateToColumn = new Map<string, number>();
  weekDates.forEach((date, index) => {
    dateToColumn.set(format(date, 'yyyy-MM-dd'), index);
  });

  // Sort by start date, then by span length (longer first)
  const sorted = [...allDayEvents].sort((a, b) => {
    const startDiff =
      parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime();
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

  // Track which cells are occupied (row -> columns set)
  const occupiedCells: Set<string>[] = [];

  for (const event of sorted) {
    // Use local dates to match the column mapping
    const startKey = getLocalDateString(event.startTime);
    const endKey = getLocalDateString(event.endTime);

    const startColumn = dateToColumn.get(startKey) ?? 0;
    const endColumn = dateToColumn.get(endKey) ?? weekDates.length - 1;
    const spanColumns = Math.min(endColumn - startColumn + 1, weekDates.length);

    // Find first available row
    let row = 0;
    let foundRow = false;

    while (!foundRow) {
      if (!occupiedCells[row]) {
        occupiedCells[row] = new Set();
      }

      // Check if all columns are available
      let available = true;
      for (let col = startColumn; col < startColumn + spanColumns; col++) {
        if (occupiedCells[row].has(col.toString())) {
          available = false;
          break;
        }
      }

      if (available) {
        foundRow = true;
        // Mark cells as occupied
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

/**
 * Calculate the height needed for all-day event rows
 */
export function getAllDayRowHeight(eventCount: number): number {
  const rowHeight = 24;
  const padding = 4;
  return Math.max(rowHeight, eventCount * (rowHeight + 2) + padding);
}
