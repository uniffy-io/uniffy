export type ViewMode = "day" | "week" | "month" | "agenda";

export const QUICK_ACCESS_FILTERS = ["today", "this_week", "upcoming"] as const;

export type QuickAccessFilter = (typeof QUICK_ACCESS_FILTERS)[number];

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
