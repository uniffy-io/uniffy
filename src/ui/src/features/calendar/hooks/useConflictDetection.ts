/**
 * Hook for detecting scheduling conflicts with existing events.
 * Used in create/edit modals to warn users about overlapping events.
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import type { CalendarEvent } from '@/features/calendar/types';

/**
 * Detect scheduling conflicts between a proposed time range and existing events.
 *
 * @param startTime - ISO string of proposed start time (null to skip)
 * @param endTime - ISO string of proposed end time (null to skip)
 * @param excludeEventId - Event ID to exclude (when editing an existing event)
 * @returns Array of conflicting events
 */
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
      // Skip the event being edited
      if (excludeEventId && event.id === excludeEventId) continue;

      // Skip all-day events (they don't block specific time slots)
      if (event.isAllDay) continue;

      const eventStart = new Date(event.startTime).getTime();
      const eventEnd = new Date(event.endTime).getTime();

      // Overlap check: proposedStart < eventEnd && eventStart < proposedEnd
      if (proposedStart < eventEnd && eventStart < proposedEnd) {
        conflicts.push(event);
      }
    }

    return conflicts;
  }, [startTime, endTime, excludeEventId, events]);
}
