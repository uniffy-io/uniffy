import { useState, useCallback } from "react";
import { useAppDispatch } from "@/app/hooks";
import { updateEvent } from "@/features/calendar/store/calendarThunks";
import type {
  CalendarEvent,
  RecurrenceConfig,
  RecurrenceEditScope,
} from "@/features/calendar/types";

/** Field subset of an event update; the routing fields are supplied by the commit hook. */
export interface EventPatch {
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  timezone?: string;
  location?: string;
  meetingUrl?: string;
  channelId?: string;
  channelAutoCreated?: boolean;
  categoryId?: string;
  attendeeIds?: string[];
  recurrence?: RecurrenceConfig;
  isFocusTime?: boolean;
  tagIds?: string[];
  reminders?: number[];
  roomId?: string;
}

/**
 * Fields the backend can apply to a single occurrence (`_collect_update_kwargs` in
 * `domains/calendar/operations.py`). Anything outside this set lands on the master no
 * matter what scope is sent, and is silently dropped for `this_event` /
 * `this_and_following` - so a patch touching one must never be offered a scope.
 */
const OCCURRENCE_SCOPABLE_FIELDS: (keyof EventPatch)[] = [
  "title",
  "description",
  "startTime",
  "endTime",
  "isAllDay",
  "timezone",
  "location",
  "meetingUrl",
  "categoryId",
  "isFocusTime",
];

function isMasterOnly(patch: EventPatch): boolean {
  return (Object.keys(patch) as (keyof EventPatch)[]).some(
    (field) => patch[field] !== undefined && !OCCURRENCE_SCOPABLE_FIELDS.includes(field),
  );
}

/**
 * Single write path for inline detail edits. A recurring series has to know which
 * occurrences an edit covers, so its patch is held until the scope dialog resolves
 * rather than written straight through.
 */
export function useEventCommit(event: CalendarEvent | null) {
  const dispatch = useAppDispatch();
  const [pendingPatch, setPendingPatch] = useState<EventPatch | null>(null);

  const isRecurring =
    !!event &&
    (event.isRecurring || (event.recurrence != null && event.recurrence.pattern !== "none"));

  const dispatchPatch = useCallback(
    (patch: EventPatch, scope?: RecurrenceEditScope) => {
      if (!event) return;
      dispatch(
        updateEvent({
          eventId: event.id,
          ...patch,
          recurrenceEditScope: scope,
          // Only the per-occurrence scopes need the date; the master path ignores it.
          occurrenceDate: scope && scope !== "all_events" ? event.occurrenceDate : undefined,
        }),
      );
    },
    [dispatch, event],
  );

  const commit = useCallback(
    (patch: EventPatch) => {
      // Channel bindings, rooms, tags, reminders, attendees and the recurrence rule itself
      // are series-level; asking which occurrences they apply to would be a question with
      // one real answer, and answering "this event" would drop the change on the floor.
      if (isRecurring && !isMasterOnly(patch)) {
        setPendingPatch(patch);
      } else {
        dispatchPatch(patch);
      }
    },
    [isRecurring, dispatchPatch],
  );

  const resolveScope = useCallback(
    (scope: RecurrenceEditScope) => {
      if (pendingPatch) dispatchPatch(pendingPatch, scope);
      setPendingPatch(null);
    },
    [pendingPatch, dispatchPatch],
  );

  const cancelScope = useCallback(() => setPendingPatch(null), []);

  return { commit, pendingPatch, resolveScope, cancelScope, isRecurring };
}
