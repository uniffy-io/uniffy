import type { CalendarInfo } from "@/features/calendar/types";

/**
 * Every member's default calendar carries the same name, so a colleague's
 * default reads as whose it is; the owner, and every other calendar, keep
 * the stored name.
 */
export function calendarLabel(
  calendar: Pick<CalendarInfo, "name" | "isDefault" | "ownerId" | "ownerName">,
  userId: string | undefined,
): string {
  if (calendar.isDefault && calendar.ownerId !== userId && calendar.ownerName) {
    return calendar.ownerName;
  }
  return calendar.name;
}
