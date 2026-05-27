export interface CalendarPreferences {
  defaultView: ViewMode;
  /** 0 = Sunday, 1 = Monday, ... */
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 24h format, e.g. '09:00'. */
  workingHoursStart: string;
  workingHoursEnd: string;
  /** Minutes. */
  defaultEventDuration: number;
  showWeekends: boolean;
  timezone: string;
  timeFormat: '12h' | '24h';
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  enableReminders: boolean;
  /** Minutes. */
  defaultReminderMinutes: number;
}

export type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export type QuickAccessFilter = 'today' | 'this_week' | 'upcoming' | 'bookmarked';

export type NavigationDirection = 'previous' | 'next';

export interface TimeSlot {
  hour: number;
  minutes: number;
  label: string;
  /** ISO time string. */
  time: string;
}

export interface DayColumn {
  date: Date;
  dayOfWeek: number;
  dayName: string;
  dayNumber: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  isWeekend: boolean;
  /** YYYY-MM-DD. */
  dateString: string;
}
