import { getEffectiveTimeZone } from "@core/datetimePrefs";

/** When a call started, in the member's display time zone and to the minute. */
export function formatCallStart(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getEffectiveTimeZone(),
  });
}

export function formatCallClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: getEffectiveTimeZone(),
  });
}
