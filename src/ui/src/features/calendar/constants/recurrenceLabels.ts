import type { RecurrencePattern, DayOfWeek } from "@/features/calendar/types/event";

export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, { short: string; full: string }> = {
  monday: { short: "Mo", full: "Monday" },
  tuesday: { short: "Tu", full: "Tuesday" },
  wednesday: { short: "We", full: "Wednesday" },
  thursday: { short: "Th", full: "Thursday" },
  friday: { short: "Fr", full: "Friday" },
  saturday: { short: "Sa", full: "Saturday" },
  sunday: { short: "Su", full: "Sunday" },
};
