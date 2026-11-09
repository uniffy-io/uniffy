import { Check, Question, X } from "@phosphor-icons/react";
import type { AttendeeStatus } from "@/features/calendar/types";

/** A guest's answer to an invite, shared by member attendees and provider-listed guests. */
export function AttendeeStatusLabel({ status }: { status: AttendeeStatus }) {
  switch (status) {
    case "accepted":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--status-success)" }}>
          <Check size={14} weight="bold" />
          <span className="text-xs">Accepted</span>
        </span>
      );
    case "declined":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--status-error)" }}>
          <X size={14} weight="bold" />
          <span className="text-xs">Declined</span>
        </span>
      );
    case "tentative":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--status-warning)" }}>
          <Question size={14} weight="bold" />
          <span className="text-xs">Maybe</span>
        </span>
      );
    default:
      return <span className="text-xs text-muted-foreground">Pending</span>;
  }
}
