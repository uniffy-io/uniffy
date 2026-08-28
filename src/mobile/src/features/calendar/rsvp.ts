import { AttendeeStatus } from "@uniffy/proto/cal/v1/calendar_pb";

export const RSVP_COLORS: Record<string, string> = {
  accepted: "#40C057",
  tentative: "#FAB005",
  pending: "#909296",
  declined: "#E64980",
};

export const RSVP_OPTIONS: { status: string; proto: AttendeeStatus; label: string }[] = [
  { status: "accepted", proto: AttendeeStatus.ACCEPTED, label: "Going" },
  { status: "tentative", proto: AttendeeStatus.TENTATIVE, label: "Maybe" },
  { status: "declined", proto: AttendeeStatus.DECLINED, label: "Decline" },
];
