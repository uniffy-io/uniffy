import type {
  Calendar,
  CalendarEvent,
  Category,
  EventActivity,
  EventTemplate,
} from "@uniffy/proto/cal/v1/calendar_pb";
import { formatRelativeSeconds } from "@shared/lib/dateFormatting";
import {
  AttendeeRole,
  AttendeeStatus,
  CalendarListSection,
  DayOfWeek,
  EventStatus,
  EventTransparency,
  EventVisibility,
  RecurrencePattern,
  ResourceType,
} from "@uniffy/proto/cal/v1/calendar_pb";
import type { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { getEffectiveTimeZone } from "@core/datetimePrefs";

// An occurrence of a recurring event is addressed as
// `{masterId}__occurrence__{date}` - a virtual id the calendar domain expands
// from the one row that actually exists. Anything naming the event AS CONTENT
// (its URN, a bookmark, a mention pasted into a note) has to name that row, or
// it points at a key nothing will ever resolve.
export const OCCURRENCE_SEPARATOR = "__occurrence__";

export type EventStatusValue = "confirmed" | "tentative" | "cancelled";
export type EventVisibilityValue = "standard" | "private";
export type EventTransparencyValue = "opaque" | "transparent";
export type AttendeeRoleValue = "organizer" | "required" | "optional";

export interface SerializedAttendee {
  id: string;
  name: string;
  email: string;
  initials: string;
  status: string;
  role: AttendeeRoleValue;
}

export interface SerializedLinkedResource {
  id: string;
  type: string;
  name: string;
}

export interface SerializedTag {
  id: string;
  name: string;
  color: string;
}

export interface SerializedRecurrence {
  pattern: string;
  interval: number;
  /** Lowercase day names ("monday".."sunday"). */
  daysOfWeek: string[];
  dayOfMonth?: number;
  endDate?: string;
  maxOccurrences?: number;
}

export interface SerializedEvent {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  dateFormatted: string;
  startTimeFormatted: string;
  endTimeFormatted: string;
  duration: string;
  location: string;
  meetingUrl?: string;
  /** Bound chat channel for a Uniffy online meeting. Read-only on mobile. */
  channelId?: string;
  calendarId: string;
  /** Set on an edited occurrence: the series row it belongs to. */
  recurrenceId?: string;
  categoryId: string;
  /** Event creator; the "Mine" scope matches this or an attendee. */
  organizerId: string;
  /** Caller's effective role, advisory only - the backend stays the gate. */
  userRole: ContentRole;
  attendees: SerializedAttendee[];
  recurrence?: SerializedRecurrence;
  isRecurring: boolean;
  /** For an expanded instance: the day it stands for (YYYY-MM-DD). */
  occurrenceDate?: string;
  linkedResources: SerializedLinkedResource[];
  tags: SerializedTag[];
  isFocusTime: boolean;
  /** Minutes before start (15, 30, 60, 1440). */
  reminders: number[];
  roomId?: string;
  roomName?: string;
  roomLocation?: string;
  roomCapacity?: number;
  roomAmenities: string[];
  status: EventStatusValue;
  visibility: EventVisibilityValue;
  transparency: EventTransparencyValue;
  isOutOfOffice: boolean;
  /** Server redacted this payload for the caller (private event, non-privileged viewer). */
  detailsHidden: boolean;
}

export interface SerializedCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

export type CalendarSection = "mine" | "shared" | "organization";

export interface SerializedCalendar {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  /** What this member sees; `useCalendars` names a colleague's default after its owner. */
  label: string;
  color: string;
  isDefault: boolean;
  /** Caller's effective role, advisory only - the backend stays the gate. */
  userRole: ContentRole;
  /** Hidden for the caller only; the server leaves its events out of range reads. */
  isHidden: boolean;
  section: CalendarSection;
}

const CALENDAR_SECTION: Record<number, CalendarSection> = {
  [CalendarListSection.MINE]: "mine",
  [CalendarListSection.SHARED]: "shared",
  [CalendarListSection.ORGANIZATION]: "organization",
};

export function calendarToPlain(calendar: Calendar): SerializedCalendar {
  return {
    id: calendar.id,
    ownerId: calendar.ownerId,
    ownerName: calendar.ownerName,
    name: calendar.name,
    label: calendar.name,
    color: calendar.color,
    isDefault: calendar.isDefault,
    userRole: calendar.userRole,
    isHidden: calendar.isHidden,
    section: CALENDAR_SECTION[calendar.section] ?? "mine",
  };
}

const ATTENDEE_STATUS: Record<number, string> = {
  [AttendeeStatus.PENDING]: "pending",
  [AttendeeStatus.ACCEPTED]: "accepted",
  [AttendeeStatus.TENTATIVE]: "tentative",
  [AttendeeStatus.DECLINED]: "declined",
};

const ATTENDEE_ROLE: Record<number, AttendeeRoleValue> = {
  [AttendeeRole.ORGANIZER]: "organizer",
  [AttendeeRole.REQUIRED]: "required",
  [AttendeeRole.OPTIONAL]: "optional",
};

const RECURRENCE_PATTERN: Record<number, string> = {
  [RecurrencePattern.DAILY]: "DAILY",
  [RecurrencePattern.WEEKLY]: "WEEKLY",
  [RecurrencePattern.BIWEEKLY]: "BIWEEKLY",
  [RecurrencePattern.MONTHLY]: "MONTHLY",
  [RecurrencePattern.YEARLY]: "YEARLY",
};

const DAY_OF_WEEK: Record<number, string> = {
  [DayOfWeek.MONDAY]: "monday",
  [DayOfWeek.TUESDAY]: "tuesday",
  [DayOfWeek.WEDNESDAY]: "wednesday",
  [DayOfWeek.THURSDAY]: "thursday",
  [DayOfWeek.FRIDAY]: "friday",
  [DayOfWeek.SATURDAY]: "saturday",
  [DayOfWeek.SUNDAY]: "sunday",
};

const EVENT_STATUS: Record<number, EventStatusValue> = {
  [EventStatus.CONFIRMED]: "confirmed",
  [EventStatus.TENTATIVE]: "tentative",
  [EventStatus.CANCELLED]: "cancelled",
};

const EVENT_VISIBILITY: Record<number, EventVisibilityValue> = {
  [EventVisibility.STANDARD]: "standard",
  [EventVisibility.PRIVATE]: "private",
};

const EVENT_TRANSPARENCY: Record<number, EventTransparencyValue> = {
  [EventTransparency.OPAQUE]: "opaque",
  [EventTransparency.TRANSPARENT]: "transparent",
};

const RESOURCE_TYPE: Record<number, string> = {
  [ResourceType.NOTE]: "note",
  [ResourceType.FILE]: "file",
  [ResourceType.CHAT]: "chat",
};

function tsToDate(ts?: { seconds: bigint; nanos: number }): Date {
  if (!ts) return new Date(0);
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6));
}

/**
 * Formats a bare YYYY-MM-DD the way `dateFormatted` renders an instant, for
 * callers holding an occurrence date rather than an event. Built from the parts
 * rather than `new Date(iso)`, which reads the string as UTC midnight and lands
 * on the previous day for anyone west of Greenwich. Already a calendar day, so
 * no timezone conversion applies.
 */
export function formatCalendarDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: getEffectiveTimeZone(),
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: getEffectiveTimeZone(),
  });
}

function formatDuration(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function recurrenceToPlain(
  recurrence: CalendarEvent["recurrence"],
): SerializedRecurrence | undefined {
  if (!recurrence) return undefined;
  return {
    pattern: RECURRENCE_PATTERN[recurrence.pattern] ?? "NONE",
    interval: recurrence.interval || 1,
    daysOfWeek: recurrence.daysOfWeek.map((d) => DAY_OF_WEEK[d]).filter(Boolean),
    dayOfMonth: recurrence.dayOfMonth,
    endDate: recurrence.endDate ? tsToDate(recurrence.endDate).toISOString() : undefined,
    maxOccurrences: recurrence.maxOccurrences,
  };
}

export function eventToPlain(event: CalendarEvent): SerializedEvent {
  const start = tsToDate(event.startTime);
  const end = tsToDate(event.endTime);
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    isAllDay: event.isAllDay,
    dateFormatted: formatDate(start),
    startTimeFormatted: formatTime(start),
    endTimeFormatted: formatTime(end),
    duration: formatDuration(start, end),
    location: event.location,
    meetingUrl: event.meetingUrl,
    channelId: event.channelId,
    calendarId: event.calendarId,
    recurrenceId: event.recurrenceId || undefined,
    categoryId: event.categoryId,
    organizerId: event.organizerId,
    userRole: event.userRole,
    attendees: event.attendees.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      initials: a.initials,
      status: ATTENDEE_STATUS[a.status] ?? "pending",
      role: ATTENDEE_ROLE[a.role] ?? "required",
    })),
    recurrence: recurrenceToPlain(event.recurrence),
    isRecurring: event.isRecurring,
    occurrenceDate: event.occurrenceDate || undefined,
    linkedResources: event.linkedResources.map((r) => ({
      id: r.id,
      type: RESOURCE_TYPE[r.type] ?? "note",
      name: r.name,
    })),
    tags: event.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    isFocusTime: event.isFocusTime,
    reminders: [...event.reminders],
    roomId: event.roomId || undefined,
    roomName: event.roomName || undefined,
    roomLocation: event.roomLocation || undefined,
    roomCapacity: event.roomCapacity,
    roomAmenities: [...event.roomAmenities],
    status: EVENT_STATUS[event.status] ?? "confirmed",
    visibility: EVENT_VISIBILITY[event.visibility] ?? "standard",
    transparency: EVENT_TRANSPARENCY[event.transparency] ?? "opaque",
    isOutOfOffice: event.isOutOfOffice,
    detailsHidden: event.detailsHidden,
  };
}

export function categoryToPlain(category: Category): SerializedCategory {
  return {
    id: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon,
  };
}

export interface SerializedTemplate {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  location: string;
  meetingUrl: string;
  categoryId: string;
}

export function templateToPlain(template: EventTemplate): SerializedTemplate {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    durationMinutes: template.durationMinutes,
    location: template.location,
    meetingUrl: template.meetingUrl,
    categoryId: template.categoryId,
  };
}

export interface SerializedActivity {
  id: string;
  actorId: string;
  /** Proto EventActivityAction value; the list maps it to a label. */
  action: number;
  atSeconds: number;
  timeLabel: string;
  fieldId?: string;
  previousValue?: string;
  newValue?: string;
}

export function activityToPlain(activity: EventActivity): SerializedActivity {
  const atSeconds = activity.timestamp ? Number(activity.timestamp.seconds) : 0;
  return {
    id: activity.id,
    actorId: activity.actorId,
    action: activity.action,
    atSeconds,
    timeLabel: formatRelativeSeconds(atSeconds),
    fieldId: activity.fieldId,
    previousValue: activity.previousValue,
    newValue: activity.newValue,
  };
}
