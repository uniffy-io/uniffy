import { useEffect, useMemo, useState } from "react";
import { addDays } from "date-fns";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { formatDate } from "@/features/calendar/utils/dateUtils";
import {
  fetchFreeBusy,
  fetchMeetingSuggestions,
  freeBusyKey,
} from "@/features/calendar/store/calendarThunks";
import { MAX_FREE_BUSY_USERS } from "@/features/calendar/types/scheduling";
import { buildDaySlots } from "@/features/calendar/components/scheduling/schedulingMath";
import { AttendeeAvailabilityGrid } from "@/features/calendar/components/scheduling/AttendeeAvailabilityGrid";
import { SuggestionList } from "@/features/calendar/components/scheduling/SuggestionList";

const SUGGESTION_WINDOW_DAYS = 7;
const DEFAULT_DURATION_MINUTES = 30;

export interface SchedulingAttendee {
  userId: string;
  name: string;
  required: boolean;
}

interface SchedulingPanelProps {
  /** Everyone to schedule for, the organizer included. */
  attendees: SchedulingAttendee[];
  startIso: string | null;
  endIso: string | null;
  roomId?: string | null;
  roomName?: string;
  disabled?: boolean;
  onPick: (startIso: string, endIso: string) => void;
  onToggleRequired?: (userId: string) => void;
}

export function SchedulingPanel({
  attendees,
  startIso,
  endIso,
  roomId,
  roomName,
  disabled,
  onPick,
  onToggleRequired,
}: SchedulingPanelProps) {
  const dispatch = useAppDispatch();
  const scheduling = useAppSelector((state) => state.calendar.scheduling);
  const loadingFreeBusy = useAppSelector((state) => state.calendar.loading.freeBusy);
  const loadingSuggestions = useAppSelector((state) => state.calendar.loading.suggestions);
  const [dayOffset, setDayOffset] = useState(0);

  // Callers pass freshly-built attendee arrays, and every fulfilled fetch
  // re-renders them through the store; key the memos on content, not array
  // identity, or the fetch effects retrigger themselves in a loop.
  const userIdsKey = attendees.map((a) => a.userId).join(",");
  const requiredIdsKey = attendees
    .filter((a) => a.required)
    .map((a) => a.userId)
    .join(",");
  const userIds = useMemo(() => (userIdsKey ? userIdsKey.split(",") : []), [userIdsKey]);
  const names = useMemo(
    () => Object.fromEntries(attendees.map((a) => [a.userId, a.name])),
    [attendees],
  );
  const requiredIds = useMemo(() => {
    const marked = requiredIdsKey ? requiredIdsKey.split(",") : [];
    return new Set(marked.length > 0 ? marked : userIds);
  }, [requiredIdsKey, userIds]);

  const overCap = userIds.length > MAX_FREE_BUSY_USERS;
  const gridDay = useMemo(
    () => addDays(startIso ? new Date(startIso) : new Date(), dayOffset),
    [startIso, dayOffset],
  );
  const slots = useMemo(() => buildDaySlots(gridDay), [gridDay]);

  const durationMinutes = useMemo(() => {
    if (!startIso || !endIso) return DEFAULT_DURATION_MINUTES;
    const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
    return Math.min(480, Math.max(5, minutes || DEFAULT_DURATION_MINUTES));
  }, [startIso, endIso]);

  const freeBusyParams = useMemo(
    () => ({
      userIds,
      windowStart: slots[0].start,
      windowEnd: slots[slots.length - 1].end,
      roomId: roomId ?? undefined,
    }),
    [userIds, slots, roomId],
  );

  useEffect(() => {
    if (overCap || userIds.length === 0) return;
    const timer = setTimeout(() => {
      dispatch(fetchFreeBusy(freeBusyParams));
    }, 300);
    return () => clearTimeout(timer);
  }, [dispatch, freeBusyParams, overCap, userIds.length]);

  useEffect(() => {
    if (overCap || userIds.length === 0) return;
    // Suggestions for an event whose start already passed should look forward
    // from now, not propose slots in the past. Compare epochs: ISO strings
    // with mixed millisecond precision do not order lexicographically.
    const now = new Date();
    const windowStart =
      startIso && Date.parse(startIso) > now.getTime() ? startIso : now.toISOString();
    const timer = setTimeout(() => {
      dispatch(
        fetchMeetingSuggestions({
          requiredUserIds: [...requiredIds],
          optionalUserIds: userIds.filter((id) => !requiredIds.has(id)),
          windowStart,
          windowEnd: addDays(new Date(windowStart), SUGGESTION_WINDOW_DAYS).toISOString(),
          durationMinutes,
          roomId: roomId ?? undefined,
        }),
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [dispatch, requiredIds, userIds, startIso, durationMinutes, roomId, overCap]);

  if (attendees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add attendees to see their availability and get suggested times.
      </p>
    );
  }
  if (overCap) {
    return (
      <p className="text-sm text-muted-foreground">
        Availability can be shown for up to {MAX_FREE_BUSY_USERS} attendees.
      </p>
    );
  }

  const dataIsCurrent = scheduling.freeBusyKey === freeBusyKey(freeBusyParams);
  const orderedUsers = dataIsCurrent
    ? userIds
        .map((id) => scheduling.freeBusy?.users.find((u) => u.userId === id))
        .filter((u) => u !== undefined)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {formatDate(gridDay, "EEE, MMM d")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDayOffset((offset) => offset - 1)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Previous day"
          >
            <CaretLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => setDayOffset((offset) => offset + 1)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Next day"
          >
            <CaretRight size={14} />
          </button>
        </div>
      </div>

      {dataIsCurrent && !loadingFreeBusy ? (
        <AttendeeAvailabilityGrid
          slots={slots}
          users={orderedUsers}
          names={names}
          requiredIds={requiredIds}
          roomBusy={roomId ? (scheduling.freeBusy?.roomBusy ?? []) : null}
          roomName={roomName}
          selectedStart={startIso}
          selectedEnd={endIso}
          onToggleRequired={onToggleRequired}
        />
      ) : (
        <div className="h-24 rounded-md bg-muted animate-pulse" />
      )}

      <div className="space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Suggested times
        </span>
        <SuggestionList
          suggestions={scheduling.suggestions}
          loading={loadingSuggestions}
          names={names}
          onPick={onPick}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
