import type { CalendarEvent } from "@/features/calendar/types";

/** Series masters and their expanded occurrences; a materialized override carries `recurrenceId` instead. */
export function isRecurringEvent(
  event: Pick<CalendarEvent, "isRecurring" | "recurrence">,
): boolean {
  return Boolean(event.isRecurring || (event.recurrence && event.recurrence.pattern !== "none"));
}
