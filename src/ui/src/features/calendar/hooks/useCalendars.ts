import { useCallback, useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import type { CalendarInfo } from "@/features/calendar/types";
import { calendarLabel } from "@/features/calendar/utils/calendarLabel";
import { memberCommitments, type ConflictScope } from "@/features/calendar/utils/eventPositioning";
import { roleCanEdit } from "@/shared/utils/contentRoles";

/** The member's calendars in the server's list order. */
export function useCalendars(): CalendarInfo[] {
  const calendars = useAppSelector((state) => state.calendar.calendars);
  const order = useAppSelector((state) => state.calendar.calendarOrder);
  return useMemo(
    () => order.map((id) => calendars[id]).filter((c): c is CalendarInfo => !!c),
    [calendars, order],
  );
}

/** Calendars the member may file events on; the default calendar leads. */
export function useWritableCalendars(): CalendarInfo[] {
  const calendars = useCalendars();
  return useMemo(
    () =>
      calendars
        .filter((calendar) => roleCanEdit(calendar.userRole))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    [calendars],
  );
}

/** The member's own default calendar, once the list has loaded. */
export function useDefaultCalendar(): CalendarInfo | undefined {
  const calendars = useCalendars();
  const userId = useAppSelector((state) => state.auth.user?.id);
  return useMemo(
    () => calendars.find((calendar) => calendar.isDefault && calendar.ownerId === userId),
    [calendars, userId],
  );
}

/** Which events on the grid can double-book the member. */
export function useConflictScope(): ConflictScope {
  const calendars = useCalendars();
  const userId = useAppSelector((state) => state.auth.user?.id);
  return useMemo(
    () =>
      memberCommitments(
        userId,
        new Set(calendars.filter((c) => c.ownerId === userId).map((c) => c.id)),
      ),
    [calendars, userId],
  );
}

/** How a calendar is named to this member (a colleague's default reads as its owner). */
export function useCalendarLabel(): (calendar: CalendarInfo) => string {
  const userId = useAppSelector((state) => state.auth.user?.id);
  return useCallback((calendar: CalendarInfo) => calendarLabel(calendar, userId), [userId]);
}
