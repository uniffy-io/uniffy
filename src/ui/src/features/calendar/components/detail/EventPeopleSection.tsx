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
import { attendeesAnswerableFor } from "@/features/calendar/utils/delegation";

type RsvpStatus = "accepted" | "tentative" | "declined";

const RSVP_CHOICES: { status: RsvpStatus; label: string; active: string }[] = [
  { status: "accepted", label: "Accept", active: "status-success border" },
  { status: "tentative", label: "Maybe", active: "status-warning border" },
  { status: "declined", label: "Decline", active: "status-error border" },
];

interface EventPeopleSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventPeopleSection({ event, canEdit, commit }: EventPeopleSectionProps) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const delegationsToMe = useAppSelector((state) => state.calendar.delegationsToMe);

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

  // Colleagues on this event whose calendar the member runs as their delegate.
  const answerableFor = useMemo(
    () => attendeesAnswerableFor(event.attendees, delegationsToMe),
    [event.attendees, delegationsToMe],
  );

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

  const handleRsvp = (status: RsvpStatus, onBehalfOfUserId?: string) => {
    dispatch(updateAttendeeStatus({ eventId: event.id, status, onBehalfOfUserId }));
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
      {currentUserAttendee && event.status !== "cancelled" && (
        <div>
          <SectionLabel>Your Response</SectionLabel>
          <RsvpButtons
            current={currentUserAttendee.status}
            onPick={(status) => handleRsvp(status)}
          />
        </div>
      )}

      {event.status !== "cancelled" &&
        answerableFor.map((attendee) => (
          <div key={attendee.id}>
            <SectionLabel>Respond for {attendee.name}</SectionLabel>
            <RsvpButtons
              current={attendee.status}
              onPick={(status) => handleRsvp(status, attendee.id)}
              label={`Respond for ${attendee.name}`}
            />
          </div>
        ))}

      {event.arrangedById && (
        <p className="text-xs text-muted-foreground">
          Booked by {event.arrangedByName || "a delegate"} on the organizer&apos;s behalf
        </p>
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
                      {attendee.respondedById && (
                        <span className="block text-xs text-muted-foreground truncate">
                          answered by {attendee.respondedByName || "a delegate"}
                        </span>
                      )}
                    </div>
                  </div>
                  {attendee.role === "organizer" ? (
                    <span className="text-xs text-muted-foreground">Organizer</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {attendee.role === "optional" && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Optional
                        </span>
                      )}
                      <AttendeeStatusLabel status={attendee.status} />
                    </span>
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

interface RsvpButtonsProps {
  current: Attendee["status"];
  onPick: (status: RsvpStatus) => void;
  label?: string;
}

function RsvpButtons({ current, onPick, label }: RsvpButtonsProps) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      {RSVP_CHOICES.map(({ status, label: choice, active }) => (
        <button
          key={status}
          type="button"
          onClick={() => onPick(status)}
          aria-pressed={current === status}
          className={cn(
            "flex-1 px-2 py-1 text-xs font-medium rounded-lg border transition-colors",
            current === status
              ? active
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {choice}
        </button>
      ))}
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
