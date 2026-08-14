import { useMemo } from "react";
import { Check, X, Question } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatar, SUBJECT_TYPE, useSubjectResolver } from "@/components/subject";
import { getInitials } from "@/components/subject/utils";
import { updateAttendeeStatus } from "@/features/calendar/store/calendarThunks";
import { AttendeesSelector } from "@/features/calendar/components/modals/AttendeesSelector";
import type { CalendarEvent, Attendee } from "@/features/calendar/types";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";

interface EventPeopleSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventPeopleSection({ event, canEdit, commit }: EventPeopleSectionProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);

  // The organizer's own attendance is implied, so RSVP counts exclude them.
  const rsvpSummary = useMemo(() => {
    const nonOrganizer = event.attendees.filter((a) => a.role !== "organizer");
    return {
      accepted: nonOrganizer.filter((a) => a.status === "accepted").length,
      declined: nonOrganizer.filter((a) => a.status === "declined").length,
      tentative: nonOrganizer.filter((a) => a.status === "tentative").length,
      pending: nonOrganizer.filter((a) => a.status === "pending").length,
    };
  }, [event.attendees]);

  const currentUserAttendee = useMemo(() => {
    if (!currentUserId) return null;
    return event.attendees.find((a) => a.id === currentUserId && a.role !== "organizer") ?? null;
  }, [event.attendees, currentUserId]);

  const invitedViaGroupIds = useMemo(
    () => [...new Set(event.attendees.map((a) => a.invitedViaGroupId).filter(Boolean))] as string[],
    [event.attendees],
  );
  const { subjects: viaSubjects } = useSubjectResolver(invitedViaGroupIds);
  // A deleted group resolves to the truncated-ID fallback (type USER); show nothing then.
  const viaGroupNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const subject of viaSubjects) {
      if (subject.type === SUBJECT_TYPE.GROUP) names.set(subject.id, subject.name);
    }
    return names;
  }, [viaSubjects]);

  const handleRsvp = (status: "accepted" | "tentative" | "declined") => {
    dispatch(updateAttendeeStatus({ eventId: event.id, status }));
  };

  const commitAttendees = (next: Attendee[]) => {
    commit({ attendeeIds: next.map((a) => a.id) });
  };

  const handleAttendeeAdd = (member: { userId: string; displayName: string; email: string }) => {
    if (event.attendees.some((a) => a.id === member.userId)) return;
    commitAttendees([
      ...event.attendees,
      {
        id: member.userId,
        name: member.displayName || member.email,
        email: member.email,
        status: "pending",
        role: "required",
        initials: getInitials(member.displayName || member.email),
      },
    ]);
  };

  const handleAttendeeRemove = (userId: string) => {
    commitAttendees(event.attendees.filter((a) => a.id !== userId));
  };

  return (
    <div className="space-y-3">
      {currentUserAttendee && (
        <div>
          <SectionLabel>Your Response</SectionLabel>
          <div className="flex items-center gap-1.5">
            {[
              { status: "accepted" as const, label: "Accept", active: "status-success border" },
              { status: "tentative" as const, label: "Maybe", active: "status-warning border" },
              { status: "declined" as const, label: "Decline", active: "status-error border" },
            ].map(({ status, label, active }) => (
              <button
                key={status}
                type="button"
                onClick={() => handleRsvp(status)}
                className={cn(
                  "flex-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors",
                  currentUserAttendee.status === status
                    ? active
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Attendees</SectionLabel>

        {(rsvpSummary.accepted > 0 ||
          rsvpSummary.declined > 0 ||
          rsvpSummary.tentative > 0 ||
          rsvpSummary.pending > 0) && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {rsvpSummary.accepted > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-success">
                <Check size={12} weight="bold" />
                {rsvpSummary.accepted}
              </span>
            )}
            {rsvpSummary.declined > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-error">
                <X size={12} weight="bold" />
                {rsvpSummary.declined}
              </span>
            )}
            {rsvpSummary.tentative > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-warning">
                <Question size={12} weight="bold" />
                {rsvpSummary.tentative}
              </span>
            )}
            {rsvpSummary.pending > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {rsvpSummary.pending} pending
              </span>
            )}
          </div>
        )}

        {canEdit ? (
          <AttendeesSelector
            attendees={event.attendees}
            onAdd={handleAttendeeAdd}
            onRemove={handleAttendeeRemove}
          />
        ) : (
          <div className="space-y-2">
            {event.attendees.map((attendee) => {
              const viaName = attendee.invitedViaGroupId
                ? viaGroupNames.get(attendee.invitedViaGroupId)
                : undefined;
              return (
                <div key={attendee.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SubjectAvatar
                      subject={{
                        id: attendee.id,
                        type: SUBJECT_TYPE.USER,
                        name: attendee.name,
                        email: attendee.email,
                        avatarUrl: attendee.avatarUrl,
                      }}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <span className="block text-sm text-foreground truncate">
                        {attendee.name}
                      </span>
                      {viaName && (
                        <span className="block text-xs text-muted-foreground truncate">
                          via {viaName}
                        </span>
                      )}
                    </div>
                  </div>
                  {attendee.role === "organizer" ? (
                    <span className="text-xs text-muted-foreground">Organizer</span>
                  ) : (
                    <AttendeeStatusLabel status={attendee.status} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AttendeeStatusLabel({ status }: { status: Attendee["status"] }) {
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
