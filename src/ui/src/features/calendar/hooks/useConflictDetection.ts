import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import type { CalendarEvent } from '@/features/calendar/types';

/** All-day events are excluded since they do not block specific time slots. */
export function useConflictDetection(
  startTime: string | null,
  endTime: string | null,
  excludeEventId?: string,
): CalendarEvent[] {
  const events = useAppSelector((state) => state.calendar.events);

  return useMemo(() => {
    if (!startTime || !endTime) return [];

    const proposedStart = new Date(startTime).getTime();
    const proposedEnd = new Date(endTime).getTime();

    if (isNaN(proposedStart) || isNaN(proposedEnd) || proposedStart >= proposedEnd) {
      return [];
    }

    const conflicts: CalendarEvent[] = [];

    for (const event of Object.values(events)) {
      if (excludeEventId && event.id === excludeEventId) continue;
      if (event.isAllDay) continue;

      const eventStart = new Date(event.startTime).getTime();
      const eventEnd = new Date(event.endTime).getTime();

      if (proposedStart < eventEnd && eventStart < proposedEnd) {
        conflicts.push(event);
      }
    }

    return conflicts;
  }, [startTime, endTime, excludeEventId, events]);
}
