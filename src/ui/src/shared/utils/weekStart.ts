/**
 * First day of the week for calendar grids, driven by the stored preference.
 * Module state synced from the settings store so pure date utils can read it.
 */

export type WeekStartDay = 0 | 1 | 6;

const WEEK_START_DAYS: Record<string, WeekStartDay> = {
  sunday: 0,
  monday: 1,
  saturday: 6,
};

let weekStartsOn: WeekStartDay = 1;

export function setPreferredWeekStart(value: string | null): void {
  weekStartsOn = WEEK_START_DAYS[value ?? ""] ?? 1;
}

export function getWeekStartsOn(): WeekStartDay {
  return weekStartsOn;
}
