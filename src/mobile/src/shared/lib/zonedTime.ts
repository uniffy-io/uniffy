import { getEffectiveTimeZone } from "@core/datetimePrefs";

/**
 * Wall-clock math in the member's display timezone, Intl-based because the
 * app carries no date library. Mirrors the web's date-fns-tz usage: instants
 * convert through the zone, calendar day tokens (plain local Dates naming a
 * day) do not.
 */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

export function zonedParts(instant: Date, timeZone: string = getEffectiveTimeZone()): ZonedParts {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // h23 still yields "24" for midnight on some engines.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Display-zone calendar day of an instant, as "YYYY-MM-DD". */
export function zonedDayKey(
  instant: Date | string,
  timeZone: string = getEffectiveTimeZone(),
): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const p = zonedParts(d, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "YYYY-MM-DD" of a calendar day token (a local Date naming a day, not an instant). */
export function localDayKey(day: Date): string {
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}

export function zonedMinutesSinceMidnight(
  instant: Date | string,
  timeZone: string = getEffectiveTimeZone(),
): number {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const p = zonedParts(d, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The instant at a wall-clock time on a calendar day, read in the display
 * zone. Two correction passes resolve the zone offset, which handles DST
 * transitions the same way date-fns-tz's fromZonedTime does.
 */
export function instantFromZonedWall(
  dateStr: string,
  timeStr: string,
  timeZone: string = getEffectiveTimeZone(),
): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, min] = timeStr.split(":").map(Number);
  const desired = Date.UTC(y, m - 1, d, h, min);
  let utc = desired;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(utc), timeZone);
    const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    utc += desired - wallAsUtc;
  }
  return new Date(utc);
}
