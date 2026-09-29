import { useEffect, useMemo, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { CalendarSelect } from "@/features/calendar/components/calendars/CalendarSelect";
import { useWritableCalendars } from "@/features/calendar/hooks/useCalendars";
import { countCalendarEvents, deleteCalendar } from "@/features/calendar/store";
import type { CalendarEventDisposition, CalendarInfo } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";

/** Mirrors the server's cap on deleting events one series at a time. */
const MAX_DELETED_EVENTS = 200;

interface DeleteCalendarDialogProps {
  calendar: CalendarInfo;
  onClose: () => void;
}

export function DeleteCalendarDialog({ calendar, onClose }: DeleteCalendarDialogProps) {
  const dispatch = useAppDispatch();
  const writable = useWritableCalendars();
  const targets = useMemo(() => writable.filter((c) => c.id !== calendar.id), [writable, calendar]);

  const [eventCount, setEventCount] = useState<number | null>(null);
  const [countFailed, setCountFailed] = useState(false);
  const [disposition, setDisposition] = useState<CalendarEventDisposition>(() =>
    targets.length > 0 ? "move" : "delete",
  );
  const [targetId, setTargetId] = useState<string | undefined>(() => targets[0]?.id);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void dispatch(countCalendarEvents(calendar.id)).then((outcome) => {
      if (cancelled) return;
      if (countCalendarEvents.fulfilled.match(outcome)) setEventCount(outcome.payload);
      else setCountFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, calendar.id]);

  const isEmpty = eventCount === 0;
  const tooManyToDelete = eventCount !== null && eventCount > MAX_DELETED_EVENTS;
  const effectiveDisposition: CalendarEventDisposition = isEmpty ? "delete" : disposition;
  // Without a count the member still chooses; the server enforces the delete cap.
  const countKnown = eventCount !== null || countFailed;
  const canSubmit =
    !submitting &&
    countKnown &&
    (effectiveDisposition === "delete" ? !tooManyToDelete : !!targetId);

  const handleDelete = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const outcome = await dispatch(
      deleteCalendar({
        calendarId: calendar.id,
        disposition: effectiveDisposition,
        targetCalendarId: effectiveDisposition === "move" ? targetId : undefined,
      }),
    );
    setSubmitting(false);
    if (deleteCalendar.fulfilled.match(outcome)) onClose();
  };

  const countLabel =
    eventCount === null
      ? countFailed
        ? "Its events could not be counted. Choose what happens to any it holds."
        : "Counting its events..."
      : isEmpty
        ? "It has no events."
        : `It holds ${eventCount} ${eventCount === 1 ? "event" : "events"}.`;

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <ModalHeader title={`Delete ${calendar.name}?`} description={countLabel} />

      <ModalBody>
        {!isEmpty && countKnown && (
          <div className="space-y-2" role="radiogroup" aria-label="What happens to its events">
            <DispositionTile
              selected={disposition === "move"}
              disabled={targets.length === 0}
              onSelect={() => setDisposition("move")}
              title="Move the events"
              detail={
                targets.length === 0
                  ? "You have no other calendar you can add events to."
                  : "Attendees keep their invitations; only the calendar changes."
              }
            >
              {disposition === "move" && targets.length > 0 && (
                <CalendarSelect
                  calendars={targets}
                  value={targetId}
                  onChange={setTargetId}
                  size="sm"
                  className="mt-2"
                  ariaLabel="Move events to"
                />
              )}
            </DispositionTile>
            <DispositionTile
              selected={disposition === "delete"}
              disabled={tooManyToDelete}
              onSelect={() => setDisposition("delete")}
              title="Delete the events"
              detail={
                tooManyToDelete
                  ? `More than ${MAX_DELETED_EVENTS} events can't be deleted at once. Move them instead.`
                  : "Attendees are told the events are cancelled."
              }
            />
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          loading={submitting}
          disabled={!canSubmit}
        >
          Delete calendar
        </Button>
      </ModalFooter>
    </Modal>
  );
}

interface DispositionTileProps {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  children?: React.ReactNode;
}

function DispositionTile({
  selected,
  disabled,
  onSelect,
  title,
  detail,
  children,
}: DispositionTileProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-card p-3 transition-shadow duration-150",
        selected ? "bg-primary/5 shadow-edge-primary" : "shadow-edge hover:shadow-edge-strong",
        disabled && "opacity-60",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={onSelect}
        className="focus-ring w-full rounded text-left disabled:cursor-not-allowed"
      >
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground mt-0.5">{detail}</span>
      </button>
      {children}
    </div>
  );
}
