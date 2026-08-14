export type ViewMode = "day" | "week" | "month" | "agenda";

export type QuickAccessFilter = "today" | "this_week" | "upcoming" | "bookmarked";

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
