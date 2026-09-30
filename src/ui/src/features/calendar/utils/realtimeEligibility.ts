import type { CalendarEvent } from "@/features/calendar/types";

export function eventSupportsRealtime(event: CalendarEvent): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const recurring = event.isRecurring || (event.recurrence && event.recurrence.pattern !== "none");
  return uuid.test(event.id) && (!recurring || Boolean(event.recurrenceId));
}
