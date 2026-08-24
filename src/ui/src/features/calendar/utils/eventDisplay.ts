import type { EventStatus, EventTransparency, EventVisibility } from "@/features/calendar/types";

interface EventDisplayInput {
  title: string;
  status: EventStatus;
  visibility: EventVisibility;
  transparency: EventTransparency;
  isOutOfOffice: boolean;
  detailsHidden: boolean;
}

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
 * One projection for every surface that draws an event, so the seven
 * renderers (grids, today widgets, mention preview) agree on what a
 * cancelled, tentative, private, or out-of-office event looks like.
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
