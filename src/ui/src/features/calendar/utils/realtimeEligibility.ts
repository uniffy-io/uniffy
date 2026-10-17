import type { CalendarEvent } from "@/features/calendar/types";
import { isRecurringEvent } from "@/features/calendar/utils/recurrence";
import { isUuid } from "@/shared/utils/uuid";

/** Live editing needs a real row: non-recurring events and materialized overrides, never a master or a synthetic occurrence. */
export function eventSupportsRealtime(event: CalendarEvent): boolean {
  return isUuid(event.id) && (!isRecurringEvent(event) || Boolean(event.recurrenceId));
}
