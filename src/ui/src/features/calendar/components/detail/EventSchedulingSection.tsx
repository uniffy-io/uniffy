import { useState } from "react";
import { CaretDown, CaretRight, UsersThree } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import type { CalendarEvent } from "@/features/calendar/types";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";
import { updateAttendeeRole } from "@/features/calendar/store/calendarThunks";
import { SchedulingPanel } from "@/features/calendar/components/scheduling/SchedulingPanel";

interface EventSchedulingSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventSchedulingSection({ event, canEdit, commit }: EventSchedulingSectionProps) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);

  if (event.attendees.length === 0) return null;

  const handleToggleRequired = (userId: string) => {
    const attendee = event.attendees.find((a) => a.id === userId);
    if (!attendee || attendee.role === "organizer") return;
    dispatch(
      updateAttendeeRole({
        eventId: event.id,
        userId,
        role: attendee.role === "optional" ? "required" : "optional",
      }),
    );
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
      >
        {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <UsersThree size={16} />
        Find a time
      </button>
      {open && (
        <div className="mt-3">
          <SchedulingPanel
            attendees={event.attendees.map((attendee) => ({
              userId: attendee.id,
              name: attendee.name,
              required: attendee.role !== "optional",
            }))}
            startIso={event.startTime}
            endIso={event.endTime}
            roomId={event.roomId}
            roomName={event.roomName}
            disabled={!canEdit}
            onPick={(startTime, endTime) => commit({ startTime, endTime })}
            onToggleRequired={canEdit ? handleToggleRequired : undefined}
          />
        </div>
      )}
    </div>
  );
}
