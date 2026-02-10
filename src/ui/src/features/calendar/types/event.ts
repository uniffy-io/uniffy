/**
 * Event type definitions for the Calendar feature
 */

import type { Attendee } from '@/features/calendar/types/attendee';

/**
 * Recurrence patterns for repeating events
 */
export type RecurrencePattern =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly';

/**
 * Days of the week for weekly recurrence
 */
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * Recurrence configuration for repeating events
 */
export interface RecurrenceConfig {
  /** The recurrence pattern */
  pattern: RecurrencePattern;
  /** Interval between recurrences (e.g., every 2 weeks) */
  interval: number;
  /** Days of the week for weekly recurrence */
  daysOfWeek?: DayOfWeek[];
  /** Day of the month for monthly recurrence */
  dayOfMonth?: number;
  /** End date for recurrence (ISO string) */
  endDate?: string;
  /** Maximum number of occurrences */
  maxOccurrences?: number;
}

/**
 * Linked resource types
 */
export type ResourceType = 'note' | 'file' | 'chat';

/**
 * A linked resource (note, file, or chat)
 */
export interface LinkedResource {
  id: string;
  type: ResourceType;
  name: string;
  url?: string;
}

/**
 * Calendar event model
 */
export interface CalendarEvent {
  /** Unique event identifier */
  id: string;
  /** Event title */
  title: string;
  /** Event description (supports markdown) */
  description: string;
  /** Start date/time (ISO string) */
  startTime: string;
  /** End date/time (ISO string) */
  endTime: string;
  /** Whether this is an all-day event */
  isAllDay: boolean;
  /** Timezone identifier (e.g., 'America/New_York') */
  timezone: string;
  /** Event location (physical or virtual) */
  location: string;
  /** Meeting URL (Zoom, Google Meet, etc.) */
  meetingUrl?: string;
  /** Calendar ID this event belongs to */
  calendarId: string;
  /** Category ID for color coding */
  categoryId: string;
  /** List of attendees */
  attendees: Attendee[];
  /** User ID of the event creator/organizer */
  organizerId: string;
  /** Recurrence configuration */
  recurrence?: RecurrenceConfig;
  /** Whether this event is marked as focus/deep work time */
  isFocusTime: boolean;
  /** Tags for categorization (e.g., '#sprint', '#client') */
  tags: string[];
  /** Linked resources (notes, files, chats) */
  linkedResources: LinkedResource[];
  /** Organization ID */
  organizationId: string;
  /** Visibility scope: 'private' for personal, 'organization' for org-wide */
  visibility: 'private' | 'organization';
  /** Created timestamp (ISO string) */
  createdAt: string;
  /** Last updated timestamp (ISO string) */
  updatedAt: string;
  /** Reminder intervals in minutes before event */
  reminders: number[];
}

/**
 * Event creation request (partial event data)
 */
export interface CreateEventRequest {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  timezone?: string;
  location?: string;
  meetingUrl?: string;
  calendarId: string;
  categoryId?: string;
  attendeeIds?: string[];
  recurrence?: RecurrenceConfig;
  isFocusTime?: boolean;
  tags?: string[];
  linkedResourceIds?: string[];
  reminders?: number[];
}

/**
 * Event update request
 */
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
  calendarId?: string;
  categoryId?: string;
  attendeeIds?: string[];
  recurrence?: RecurrenceConfig;
  isFocusTime?: boolean;
  tags?: string[];
  linkedResourceIds?: string[];
  reminders?: number[];
}

/**
 * Multi-day event span position
 */
export type MultiDayPosition = 'start' | 'middle' | 'end' | 'single';

/**
 * Positioned event for rendering on the calendar grid
 * Includes calculated position and size values
 */
export interface PositionedEvent extends CalendarEvent {
  /** Top position in pixels from start of day */
  top: number;
  /** Height in pixels */
  height: number;
  /** Left offset for overlapping events (0-1) */
  left: number;
  /** Width multiplier for overlapping events (0-1) */
  width: number;
  /** Column index for overlapping events */
  column: number;
  /** Total columns for this time slot */
  totalColumns: number;
  /** Position in multi-day span (start/middle/end/single) */
  multiDayPosition?: MultiDayPosition;
  /** Whether this event has time conflicts with other events */
  hasConflict?: boolean;
  /** List of events that conflict with this one */
  conflictingEvents?: CalendarEvent[];
}
