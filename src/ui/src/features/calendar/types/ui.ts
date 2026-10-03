export interface EventModalPrefill {
  date?: string;
  startTime?: string;
  endTime?: string;
  calendarId?: string;
  categoryId?: string;
  title?: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  tagIds?: string[];
  durationMinutes?: number;
  /** Event id when opening in edit mode. */
  eventId?: string;
  context?: "calendar" | "chat" | "note";
  suggestedAttendees?: string[];
  suggestedResources?: string[];
}

export interface DropTarget {
  /** ISO date string. */
  date: string;
  hour: number;
  /** 0, 15, 30, or 45. */
  minutes: number;
}

export type SidebarSectionId =
  | "quick_access"
  | "mini_calendar"
  | "calendars"
  | "shared_calendars"
  | "organization"
  | "categories"
  | "templates"
  | "tags";

export interface EventFilters {
  /** Empty = all visible. */
  calendarIds: string[];
  categoryIds: string[];
  /** Unified-tag ids. */
  tagIds: string[];
  searchQuery: string;
  focusTimeOnly: boolean;
  dateRangeStart?: string;
  dateRangeEnd?: string;
}
