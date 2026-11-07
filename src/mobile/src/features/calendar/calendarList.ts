import { roleCanEdit } from "@shared/permissions/contentRoles";
import type {
  CalendarProviderValue,
  CalendarSection,
  SerializedCalendar,
  SerializedCategory,
  SerializedEvent,
} from "@features/calendar/calendarSerializer";

export const PROVIDER_LABEL: Record<CalendarProviderValue, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
};

export const CALENDAR_SECTIONS: { section: CalendarSection; title: string }[] = [
  { section: "mine", title: "My calendars" },
  { section: "subscribed", title: "Subscribed" },
  { section: "connected", title: "Connected" },
  { section: "shared", title: "Shared with me" },
  { section: "organization", title: "Organization" },
];

/**
 * An event paints in its calendar's colour, so a shared calendar reads as one
 * block on the grid; the category colour only fills in while the calendar list
 * has not loaded, matching the web calendar.
 */
export function resolveEventColor(
  event: Pick<SerializedEvent, "calendarId" | "categoryId">,
  calendarsById: ReadonlyMap<string, SerializedCalendar>,
  categoriesById: ReadonlyMap<string, SerializedCategory>,
  fallback: string,
): string {
  const calendar = calendarsById.get(event.calendarId);
  if (calendar?.color) return calendar.color;
  const category = event.categoryId ? categoriesById.get(event.categoryId) : undefined;
  return category?.color || fallback;
}

function isOwnDefault(calendar: SerializedCalendar): boolean {
  return calendar.isDefault && calendar.section === "mine";
}

/** Calendars the member may file events on; their own default calendar leads. */
export function writableCalendars(calendars: readonly SerializedCalendar[]): SerializedCalendar[] {
  return calendars
    .filter((calendar) => !calendar.isReadOnly && roleCanEdit(calendar.userRole))
    .sort((a, b) => Number(isOwnDefault(b)) - Number(isOwnDefault(a)));
}

/** Short context for a picker row: whose calendar it is, when it is not simply one of the member's. */
export function calendarHint(calendar: SerializedCalendar): string | undefined {
  if (isOwnDefault(calendar)) return "Default";
  if (calendar.section === "connected") return connectionHint(calendar) ?? "Connected";
  if (calendar.section === "subscribed") return "Subscribed";
  if (calendar.section === "shared") return "Shared with you";
  if (calendar.section === "organization") return "Open to the organization";
  return undefined;
}

/** Which provider account a connected calendar mirrors, e.g. "Google Calendar · ada@example.com". */
export function connectionHint(calendar: SerializedCalendar): string | undefined {
  if (!calendar.connection) return undefined;
  const provider = PROVIDER_LABEL[calendar.connection.provider];
  const email = calendar.connection.accountEmail;
  return email ? `${provider} · ${email}` : provider;
}

/** Why an event cannot be changed here, when its calendar mirrors an outside source. */
export function providerEditNote(
  event: Pick<
    SerializedEvent,
    "providerEditHint" | "isRecurring" | "recurrenceId" | "isMirroredOccurrence"
  >,
  calendar?: Pick<SerializedCalendar, "isReadOnly" | "section">,
): string | undefined {
  if (event.providerEditHint) {
    const series = event.isRecurring || !!event.recurrenceId || event.isMirroredOccurrence;
    return `Edit this ${series ? "series" : "event"} in ${PROVIDER_LABEL[event.providerEditHint]}.`;
  }
  if (calendar?.isReadOnly && calendar.section === "connected") {
    return "From a read-only connected calendar. Changes come from its source.";
  }
  if (calendar?.isReadOnly) return "From a subscribed calendar. Changes come from its source.";
  return undefined;
}

/** The member's own default calendar; a colleague's default can be shared with them too. */
export function defaultCalendarFor(
  calendars: readonly SerializedCalendar[],
  userId: string | undefined,
): SerializedCalendar | undefined {
  if (!userId) return undefined;
  return calendars.find((calendar) => calendar.isDefault && calendar.ownerId === userId);
}

/**
 * A shared calendar puts colleagues' meetings on the grid without making them
 * the member's commitments, so only what the member organizes, attends (short
 * of declining) or files on a calendar of their own can double-book them.
 */
export function memberCommitments(
  userId: string | undefined,
  ownCalendarIds: ReadonlySet<string>,
): (event: Pick<SerializedEvent, "calendarId" | "organizerId" | "attendees">) => boolean {
  return (event) =>
    ownCalendarIds.has(event.calendarId) ||
    (!!userId &&
      (event.organizerId === userId ||
        event.attendees.some((a) => a.id === userId && a.status !== "declined")));
}

/**
 * Every member's default calendar carries the same name, so a colleague's
 * default reads as whose it is; the owner, and every other calendar, keep
 * the stored name.
 */
export function calendarLabel(
  calendar: Pick<SerializedCalendar, "name" | "isDefault" | "ownerId" | "ownerName">,
  userId: string | undefined,
): string {
  if (calendar.isDefault && calendar.ownerId !== userId && calendar.ownerName) {
    return calendar.ownerName;
  }
  return calendar.name;
}
