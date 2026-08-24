import { useState } from "react";
import { CaretDown, CaretRight, UsersThree } from "@phosphor-icons/react";
import type { CalendarEvent } from "@/features/calendar/types";
import type { EventPatch } from "@/features/calendar/hooks/useEventCommit";
import { SchedulingPanel } from "@/features/calendar/components/scheduling/SchedulingPanel";

interface EventSchedulingSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventSchedulingSection({ event, canEdit, commit }: EventSchedulingSectionProps) {
  const [open, setOpen] = useState(false);

  if (event.attendees.length === 0) return null;

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
          />
        </div>
      )}
    </div>
  );
}
