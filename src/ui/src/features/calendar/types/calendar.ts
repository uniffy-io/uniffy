/**
 * Calendar type definitions
 */

/**
 * A user's calendar (Personal, Work, Team, etc.)
 */
export interface Calendar {
  /** Unique calendar identifier */
  id: string;
  /** Calendar display name */
  name: string;
  /** Color for calendar events (hex or CSS color) */
  color: string;
  /** Whether calendar is visible in the grid */
  isVisible: boolean;
  /** Whether this is the default calendar for new events */
  isDefault: boolean;
  /** Owner user ID */
  ownerId: string;
  /** Organization ID */
  organizationId: string;
  /** Calendar type for grouping */
  type: CalendarType;
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Calendar types
 */
export type CalendarType = 'personal' | 'work' | 'team' | 'shared';

/**
 * User's calendar preferences
 */
export interface CalendarPreferences {
  /** Default view mode */
  defaultView: ViewMode;
  /** Start of week (0 = Sunday, 1 = Monday, etc.) */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Working hours start time (24h format, e.g., '09:00') */
  workingHoursStart: string;
  /** Working hours end time (24h format, e.g., '17:00') */
  workingHoursEnd: string;
  /** Default event duration in minutes */
  defaultEventDuration: number;
  /** Show weekends in week view */
  showWeekends: boolean;
  /** Default timezone */
  timezone: string;
  /** Time format (12h or 24h) */
  timeFormat: '12h' | '24h';
  /** Date format */
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  /** Enable reminder notifications */
  enableReminders: boolean;
  /** Default reminder time before event (in minutes) */
  defaultReminderMinutes: number;
}

/**
 * Calendar view modes
 */
export type ViewMode = 'day' | 'week' | 'month';

/**
 * Quick access filter options
 */
export type QuickAccessFilter = 'today' | 'this_week' | 'upcoming' | 'bookmarked';

/**
 * Navigation direction
 */
export type NavigationDirection = 'previous' | 'next';

/**
 * Time slot representation for grid rendering
 */
export interface TimeSlot {
  /** Hour (0-23) */
  hour: number;
  /** Minutes (0, 30 for half-hour slots) */
  minutes: number;
  /** Display label (e.g., '9 AM', '14:30') */
  label: string;
  /** ISO time string for this slot */
  time: string;
}

/**
 * Day column representation for week/month views
 */
export interface DayColumn {
  /** Date object */
  date: Date;
  /** Day of week (0-6) */
  dayOfWeek: number;
  /** Day name (e.g., 'Mon', 'Monday') */
  dayName: string;
  /** Day number (1-31) */
  dayNumber: number;
  /** Whether this is today */
  isToday: boolean;
  /** Whether this is in the current month */
  isCurrentMonth: boolean;
  /** Whether this is a weekend */
  isWeekend: boolean;
  /** ISO date string (YYYY-MM-DD) */
  dateString: string;
}
