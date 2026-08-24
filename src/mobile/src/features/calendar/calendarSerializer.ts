import type { CalendarEvent, Category } from "@uniffy/proto/cal/v1/calendar_pb";
import { AttendeeStatus, RecurrencePattern, ResourceType } from "@uniffy/proto/cal/v1/calendar_pb";
import type { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { getEffectiveTimeZone } from "@core/datetimePrefs";

export interface SerializedAttendee {
  id: string;
  name: string;
  email: string;
  initials: string;
  status: string;
}

export interface SerializedLinkedResource {
  id: string;
  type: string;
  name: string;
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
  categoryId: string;
  /** Event creator; the "Mine" scope matches this or an attendee. */
  organizerId: string;
  /** Caller's effective role, advisory only - the backend stays the gate. */
  userRole: ContentRole;
  attendees: SerializedAttendee[];
  recurrence?: { pattern: string };
  linkedResources: SerializedLinkedResource[];
  tags: string[];
}

export interface SerializedCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
}

const ATTENDEE_STATUS: Record<number, string> = {
  [AttendeeStatus.PENDING]: "pending",
  [AttendeeStatus.ACCEPTED]: "accepted",
  [AttendeeStatus.TENTATIVE]: "tentative",
  [AttendeeStatus.DECLINED]: "declined",
};

const RECURRENCE_PATTERN: Record<number, string> = {
  [RecurrencePattern.DAILY]: "DAILY",
  [RecurrencePattern.WEEKLY]: "WEEKLY",
  [RecurrencePattern.BIWEEKLY]: "BIWEEKLY",
  [RecurrencePattern.MONTHLY]: "MONTHLY",
  [RecurrencePattern.YEARLY]: "YEARLY",
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
    categoryId: event.categoryId,
    organizerId: event.organizerId,
    userRole: event.userRole,
    attendees: event.attendees.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      initials: a.initials,
      status: ATTENDEE_STATUS[a.status] ?? "pending",
    })),
    recurrence: event.recurrence
      ? { pattern: RECURRENCE_PATTERN[event.recurrence.pattern] ?? "NONE" }
      : undefined,
    linkedResources: event.linkedResources.map((r) => ({
      id: r.id,
      type: RESOURCE_TYPE[r.type] ?? "note",
      name: r.name,
    })),
    tags: event.tags.map((t) => t.name),
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
