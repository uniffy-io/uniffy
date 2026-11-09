import { SubjectAvatar, SUBJECT_TYPE } from "@/components/subject";
import { AttendeeStatusLabel } from "@/features/calendar/components/detail/AttendeeStatusLabel";
import { SectionLabel } from "@/features/calendar/components/detail/SectionLabel";
import type { EventParticipant } from "@/features/calendar/types";

interface EventParticipantsSectionProps {
  participants: EventParticipant[];
}

/** The guests a connected calendar's provider lists, read-only. */
export function EventParticipantsSection({ participants }: EventParticipantsSectionProps) {
  if (participants.length === 0) return null;
  return (
    <div data-testid="event-participants">
      <SectionLabel>External guests ({participants.length})</SectionLabel>
      <ul className="space-y-2">
        {participants.map((participant) => {
          const name = participant.displayName || participant.email;
          return (
            <li key={participant.email} className="flex items-center gap-2 text-sm">
              <SubjectAvatar
                subject={{
                  id: participant.userId ?? participant.email,
                  type: SUBJECT_TYPE.USER,
                  name,
                  email: participant.email,
                }}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{name}</span>
                {participant.displayName && (
                  <span className="block truncate text-xs text-subtle-foreground">
                    {participant.email}
                  </span>
                )}
              </span>
              {participant.isOrganizer ? (
                <span className="text-xs text-muted-foreground">Organizer</span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-2">
                  {participant.isOptional && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Optional
                    </span>
                  )}
                  <AttendeeStatusLabel status={participant.response} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
