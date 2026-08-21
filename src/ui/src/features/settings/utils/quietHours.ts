export const DEFAULT_QUIET_HOURS_START = "22:00";
export const DEFAULT_QUIET_HOURS_END = "08:00";

const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidClockTime(value: string): boolean {
  return CLOCK_RE.test(value);
}

export function quietHoursValidationError(start: string, end: string): string | null {
  if (!isValidClockTime(start)) return "Start time must use HH:MM";
  if (!isValidClockTime(end)) return "End time must use HH:MM";
  if (start === end) return "Start and end times must differ";
  return null;
}

export function clockTimeToDecimalHours(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour + minute / 60;
}

export function decimalHoursToClockTime(value: number): string {
  const total = Math.round(value * 60);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface QuietHoursUpdate {
  quietHoursStart: string;
  quietHoursEnd: string;
}

export function quietHoursToggleUpdate(enabled: boolean): QuietHoursUpdate {
  return enabled
    ? { quietHoursStart: DEFAULT_QUIET_HOURS_START, quietHoursEnd: DEFAULT_QUIET_HOURS_END }
    : { quietHoursStart: "", quietHoursEnd: "" };
}
