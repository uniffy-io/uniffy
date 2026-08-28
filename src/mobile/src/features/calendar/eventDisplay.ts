import { getEffectiveTimeZone } from "@core/datetimePrefs";
import type { SerializedEvent, SerializedRecurrence } from "@features/calendar/calendarSerializer";

type EventDisplayInput = Pick<
  SerializedEvent,
  "title" | "status" | "visibility" | "transparency" | "isOutOfOffice" | "detailsHidden"
>;

export interface EventDisplayState {
  /** Render title: the server-redacted busy label when details are hidden. */
  title: string;
  /** Struck through everywhere it appears. */
  cancelled: boolean;
  /** Faded, alongside the RSVP-driven fade the grids already apply. */
  tentative: boolean;
  outOfOffice: boolean;
  /** Transparent event: on the calendar but never busy. */
  free: boolean;
  detailsHidden: boolean;
}

/**
 * One projection for every surface that draws an event, so the grids, agenda,
 * and detail screen agree on what a cancelled, tentative, private, or
 * out-of-office event looks like. Same contract as the web eventDisplayState.
 */
export function eventDisplayState(event: EventDisplayInput): EventDisplayState {
  return {
    title: event.detailsHidden ? (event.isOutOfOffice ? "Out of office" : "Busy") : event.title,
    cancelled: event.status === "cancelled",
    tentative: event.status === "tentative",
    outOfOffice: event.isOutOfOffice,
    free: event.transparency === "transparent",
    detailsHidden: event.detailsHidden,
  };
}

/** Cancelled and free (transparent) events never count as conflicts. */
export function blocksTime(event: Pick<SerializedEvent, "status" | "transparency">): boolean {
  return event.status !== "cancelled" && event.transparency !== "transparent";
}

const DAY_SHORT: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const PATTERN_BASE: Record<string, { one: string; unit: string }> = {
  DAILY: { one: "Daily", unit: "day" },
  WEEKLY: { one: "Weekly", unit: "week" },
  BIWEEKLY: { one: "Every 2 weeks", unit: "week" },
  MONTHLY: { one: "Monthly", unit: "month" },
  YEARLY: { one: "Yearly", unit: "year" },
};

/** Human summary of a recurrence rule ("Every 2 weeks on Mon, Wed · until Sep 30"). */
export function recurrenceLabel(recurrence: SerializedRecurrence | undefined): string {
  if (!recurrence) return "";
  const base = PATTERN_BASE[recurrence.pattern];
  if (!base) return "Recurring";
  // BIWEEKLY states its own cadence; applying its interval would double-count.
  const interval = recurrence.pattern === "BIWEEKLY" ? 1 : recurrence.interval;
  let label = interval === 1 ? base.one : `Every ${interval} ${base.unit}s`;
  const weekOrder = Object.keys(DAY_SHORT);
  const days = [...recurrence.daysOfWeek]
    .sort((a, b) => weekOrder.indexOf(a) - weekOrder.indexOf(b))
    .map((d) => DAY_SHORT[d])
    .filter(Boolean);
  if (days.length > 0 && days.length < 7) {
    label += ` on ${days.join(", ")}`;
  }
  if (recurrence.pattern === "MONTHLY" && recurrence.dayOfMonth) {
    label += ` on day ${recurrence.dayOfMonth}`;
  }
  if (recurrence.endDate) {
    const until = new Date(recurrence.endDate).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: getEffectiveTimeZone(),
    });
    label += ` · until ${until}`;
  }
  if (recurrence.maxOccurrences) {
    label += ` · ${recurrence.maxOccurrences} times`;
  }
  return label;
}
