import { useEffect, useMemo, useState } from "react";
import { VideoCamera } from "@phosphor-icons/react";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { EventStatus } from "@uniffy/proto/cal/v1/calendar_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { calendarApi } from "@/features/calendar/api/calendarApi";
import { LiveMeetingBadge } from "@/features/calendar/components/shared/LiveMeetingBadge";
import { prejoinOpened, selectActiveCallForChannel } from "@/features/calls/store/callsSlice";
import {
  formatCountdown,
  pickNextMeeting,
  type MeetingCandidate,
} from "@/features/chat/utils/nextMeeting";
import { Button } from "@/components/ui/button";
import type { RootState } from "@/app/store";

const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const REFETCH_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;

interface ChannelNextMeetingProps {
  channelId: string;
}

/**
 * Upcoming meeting bound to this channel, with a countdown and a way in. The
 * meeting lives on the calendar but happens here, so the strip reads calendar
 * data directly rather than through the calendar store, which the chat page
 * never loads.
 */
export function ChannelNextMeeting({ channelId }: ChannelNextMeetingProps) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const activeCall = useAppSelector((s: RootState) => selectActiveCallForChannel(s, channelId));
  const [candidates, setCandidates] = useState<MeetingCandidate[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;

    const load = () => {
      const from = new Date();
      calendarApi
        .getEventsInRange({
          organizationId,
          channelId,
          startDate: timestampFromDate(from),
          endDate: timestampFromDate(new Date(from.getTime() + LOOKAHEAD_MS)),
        })
        .then((res) => {
          if (cancelled) return;
          setCandidates(
            res.events.map((event) => ({
              id: event.id,
              title: event.detailsHidden ? "Busy" : event.title,
              startTime: event.startTime ? timestampDate(event.startTime).toISOString() : "",
              endTime: event.endTime ? timestampDate(event.endTime).toISOString() : "",
              cancelled: event.status === EventStatus.CANCELLED,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        });
    };

    // Clear on a channel switch so the strip never advertises the previous
    // channel's meeting while the new fetch is in flight.
    // eslint-disable-next-line react/react-compiler
    setCandidates([]);
    load();
    const refetch = setInterval(load, REFETCH_MS);
    return () => {
      cancelled = true;
      clearInterval(refetch);
    };
  }, [channelId, organizationId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  const meeting = useMemo(() => pickNextMeeting(candidates, now), [candidates, now]);

  if (!meeting) return null;

  const isLive = !!activeCall;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <VideoCamera size={14} weight="duotone" className="shrink-0 text-muted-foreground" />
      <span className="truncate text-xs font-medium text-foreground">{meeting.title}</span>
      {isLive ? (
        <LiveMeetingBadge participantCount={activeCall?.participants.length ?? 0} />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatCountdown(meeting.startTime, now)}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant={isLive ? "default" : "ghost"}
        className="ml-auto shrink-0"
        onClick={() => dispatch(prejoinOpened({ channelId }))}
      >
        <VideoCamera size={14} weight="fill" />
        {isLive ? "Join now" : "Join"}
      </Button>
    </div>
  );
}
