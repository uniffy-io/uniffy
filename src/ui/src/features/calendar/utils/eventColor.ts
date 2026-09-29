import { ACCENT_EVENT_COLOR } from "@/features/calendar/constants/categoryColors";
import type { CalendarInfo, Category } from "@/features/calendar/types";

/**
 * An event takes its calendar's colour, so every calendar reads apart on the grid.
 * The category colour only fills in for a calendar the member cannot list.
 */
export function resolveEventColor(
  event: { categoryId?: string; calendarId: string },
  categories: Record<string, Category>,
  calendars: Record<string, CalendarInfo>,
): string {
  const calendar = calendars[event.calendarId];
  if (calendar) return calendar.color;
  const category = event.categoryId ? categories[event.categoryId] : undefined;
  return category?.color ?? ACCENT_EVENT_COLOR;
}
