import type {
  Attendee,
  CalendarDelegationInfo,
  CalendarDelegationLevel,
} from "@/features/calendar/types";

export const DELEGATION_LEVEL_OPTIONS: {
  value: CalendarDelegationLevel;
  label: string;
  description: string;
}[] = [
  {
    value: "events",
    label: "Events",
    description: "Book, edit, cancel and answer invitations. Private events stay busy-only.",
  },
  {
    value: "events_and_private",
    label: "Events and private details",
    description: "Everything above, and private events show their details.",
  },
];

export const delegationLevelLabel = (level: CalendarDelegationLevel): string =>
  DELEGATION_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? "Events";

/** Attendees of an event the member may answer for, as a delegate of theirs. */
export const attendeesAnswerableFor = (
  attendees: Attendee[],
  delegationsToMe: CalendarDelegationInfo[],
): Attendee[] => {
  const grantors = new Set(
    delegationsToMe.filter((delegation) => !delegation.inactive).map((d) => d.grantorId),
  );
  return attendees.filter((attendee) => grantors.has(attendee.id) && attendee.role !== "organizer");
};
