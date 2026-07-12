import type { Attendee } from '@/features/calendar/types/attendee';

export type RecurrencePattern =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly';

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface RecurrenceConfig {
  pattern: RecurrencePattern;
  /** Step between recurrences (e.g. every 2 weeks). */
  interval: number;
  daysOfWeek?: DayOfWeek[];
  dayOfMonth?: number;
  /** ISO string. */
  endDate?: string;
  maxOccurrences?: number;
}

export type ResourceType = 'note' | 'file' | 'chat';

export interface LinkedResource {
  id: string;
  type: ResourceType;
  name: string;
  url?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** Markdown. */
  description: string;
  /** ISO string. */
  startTime: string;
  /** ISO string. */
  endTime: string;
  isAllDay: boolean;
  /** IANA timezone (e.g. 'America/New_York'). */
  timezone: string;
  location: string;
  meetingUrl?: string;
  /** Bound chat channel for a Uniffy online meeting (mutually exclusive with meetingUrl). */
  channelId?: string;
  /** True when the bound channel was auto-created as a meeting room for this event. */
  channelAutoCreated?: boolean;
  calendarId: string;
  categoryId: string;
  attendees: Attendee[];
  organizerId: string;
  recurrence?: RecurrenceConfig;
  isFocusTime: boolean;
  /** Unified-tag ids resolved via the tags slice cache. */
  tagIds: string[];
  linkedResources: LinkedResource[];
  organizationId: string;
  /** 'private' = personal, 'organization' = org-wide. */
  visibility: 'private' | 'organization';
  createdAt: string;
  updatedAt: string;
  /** Minutes before event. */
  reminders: number[];
  isRecurring?: boolean;
  /** Master event id when this row overrides a recurring occurrence. */
  recurrenceId?: string;
  /** YYYY-MM-DD for expanded instances. */
  occurrenceDate?: string;
  roomId?: string;
  /** Read-only, mirrored from room booking. */
  roomName?: string;
  roomLocation?: string;
  roomCapacity?: number;
  roomAmenities?: string[];
}

export type RecurrenceEditScope = 'this_event' | 'all_events' | 'this_and_following';

export interface CreateEventRequest {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  timezone?: string;
  location?: string;
  meetingUrl?: string;
  channelId?: string;
  channelAutoCreated?: boolean;
  calendarId: string;
  categoryId?: string;
  attendeeIds?: string[];
  recurrence?: RecurrenceConfig;
  isFocusTime?: boolean;
  tagIds?: string[];
  linkedResourceIds?: string[];
  reminders?: number[];
}

export interface UpdateEventRequest {
  id: string;
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  timezone?: string;
  location?: string;
  meetingUrl?: string;
  /** Empty string clears the binding; undefined leaves it untouched. */
  channelId?: string;
  calendarId?: string;
  categoryId?: string;
  attendeeIds?: string[];
  recurrence?: RecurrenceConfig;
  isFocusTime?: boolean;
  tagIds?: string[];
  linkedResourceIds?: string[];
  reminders?: number[];
  recurrenceEditScope?: RecurrenceEditScope;
  occurrenceDate?: string;
}

export type MultiDayPosition = 'start' | 'middle' | 'end' | 'single';

/** CalendarEvent with grid-layout fields computed for rendering. */
export interface PositionedEvent extends CalendarEvent {
  top: number;
  height: number;
  /** 0-1 offset within the day column for overlapping events. */
  left: number;
  /** 0-1 width multiplier for overlapping events. */
  width: number;
  column: number;
  totalColumns: number;
  multiDayPosition?: MultiDayPosition;
  hasConflict?: boolean;
  conflictingEvents?: CalendarEvent[];
}
