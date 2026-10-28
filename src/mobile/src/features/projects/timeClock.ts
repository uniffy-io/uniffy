import { formatMinutes } from "@features/projects/timeFormatting";

export const DAY_MINUTES = 1440;

/** "HH:mm" to minutes since midnight. */
export function minutesOfDay(wall: string): number {
  const [hours, minutes] = wall.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:mm"; 1440 reads as "24:00". */
export function wallOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, minutes));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** The end a start and a length imply, capped at midnight. */
export function endOf(start: string, durationMinutes: number): string {
  return wallOf(minutesOfDay(start) + durationMinutes);
}

/**
 * Why an entry of this length, starting at this time, cannot be saved; null when it can.
 * A day holds 24h, and an entry on the clock has to end by midnight of its own day.
 */
export function entryProblem(durationMinutes: number | null, start: string | null): string | null {
  if (durationMinutes === null) return null;
  if (durationMinutes > DAY_MINUTES) {
    return `An entry can hold at most 24h, and ${formatMinutes(durationMinutes)} is longer than a day. Split it into one entry per day.`;
  }
  if (start && minutesOfDay(start) + durationMinutes > DAY_MINUTES) {
    return `Starting at ${start}, at most ${formatMinutes(DAY_MINUTES - minutesOfDay(start))} fits before midnight.`;
  }
  return null;
}
