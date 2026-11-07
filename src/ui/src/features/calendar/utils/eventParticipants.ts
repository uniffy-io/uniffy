import type { CalendarEvent, EventParticipant } from "@/features/calendar/types";

/** Guests from outside the organization; members already appear among the attendees. */
export function externalParticipants(event: CalendarEvent): EventParticipant[] {
  return (event.participants ?? []).filter((participant) => !participant.userId);
}
