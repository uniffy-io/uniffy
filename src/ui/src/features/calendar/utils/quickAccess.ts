import { parseISO, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import type { CalendarEvent, QuickAccessFilter } from '@/features/calendar/types';

/** Multi-day and all-day events count as matching whenever they overlap the window, not only when they start in it. */
function overlapsWindow(event: CalendarEvent, start: Date, end: Date): boolean {
  return parseISO(event.startTime) <= end && parseISO(event.endTime) >= start;
}

export function matchesQuickAccess(
  event: CalendarEvent,
  filter: QuickAccessFilter,
  now: Date,
  bookmarkedUrns: Record<string, boolean>,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): boolean {
  switch (filter) {
    case 'today':
      return overlapsWindow(event, startOfDay(now), endOfDay(now));
    case 'this_week':
      return overlapsWindow(
        event,
        startOfWeek(now, { weekStartsOn }),
        endOfWeek(now, { weekStartsOn })
      );
    case 'upcoming':
      return parseISO(event.endTime) >= now;
    case 'bookmarked':
      return bookmarkedUrns[`urn:uniffy:content:CALENDAR_EVENT:${event.id}`] ?? false;
    default:
      return true;
  }
}
