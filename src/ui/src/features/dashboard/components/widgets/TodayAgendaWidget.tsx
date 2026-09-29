import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarBlank, MapPin, Clock, ArrowRight } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import {
  WidgetCard,
  EmptyWidget,
  WidgetSkeleton,
} from "@/features/dashboard/components/widgets/WidgetCard";
import { effectiveDayKey, formatDateFull, formatTimeInZone } from "@/shared/utils/dateFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import type { CalendarEvent } from "@/features/calendar/types";
import { eventDisplayState } from "@/features/calendar/utils/eventDisplay";
import { resolveEventColor } from "@/features/calendar/utils/eventColor";

function formatEventTime(event: CalendarEvent): string {
  if (event.isAllDay) return "All day";
  const zone = getEffectiveTimeZone();
  const startStr = formatTimeInZone(new Date(event.startTime), zone);
  const endStr = formatTimeInZone(new Date(event.endTime), zone);
  return `${startStr} - ${endStr}`;
}

function isCurrentEvent(event: CalendarEvent): boolean {
  if (event.isAllDay) return true;
  const now = new Date();
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  return now >= start && now <= end;
}

function isNextEvent(event: CalendarEvent, allEvents: CalendarEvent[]): boolean {
  if (event.isAllDay) return false;
  const now = new Date();
  const start = new Date(event.startTime);
  if (start <= now) return false;

  const futureEvents = allEvents
    .filter((e) => !e.isAllDay && new Date(e.startTime) > now)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  return futureEvents[0]?.id === event.id;
}

function EventItem({
  event,
  categoryColor,
  isCurrent,
  isNext,
}: {
  event: CalendarEvent;
  categoryColor: string;
  isCurrent: boolean;
  isNext: boolean;
}) {
  return (
    <Link
      to={`/calendar?event=${event.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg p-2.5 -mx-2 transition-colors",
        isCurrent && "bg-primary/5 border border-primary/20",
        isNext && "bg-muted/50",
        !isCurrent && !isNext && "hover:bg-muted/50",
      )}
    >
      <div
        className="w-1 min-h-[36px] rounded-full flex-shrink-0 mt-0.5"
        style={{ backgroundColor: categoryColor }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors",
              eventDisplayState(event).cancelled && "line-through opacity-60",
            )}
          >
            {eventDisplayState(event).title}
          </p>
          {isCurrent && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
              Now
            </span>
          )}
          {isNext && !isCurrent && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
              Next
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            {formatEventTime(event)}
          </span>
          {event.location && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
              <MapPin size={12} />
              {event.location}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function TodayAgendaWidget() {
  const navigate = useNavigate();
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const categories = useAppSelector((state) => state.calendar?.categories ?? {});
  const calendars = useAppSelector((state) => state.calendar?.calendars ?? {});
  const isLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  const { allDayEvents, timedEvents, nextEventOutsideToday } = useMemo(() => {
    const now = new Date();
    // "Today" is the display zone's calendar day, not the device's.
    const todayKey = effectiveDayKey(now);

    const todayEvents = Object.values(events).filter(
      (event: CalendarEvent) => effectiveDayKey(new Date(event.startTime)) === todayKey,
    );

    const allDay = todayEvents
      .filter((e: CalendarEvent) => e.isAllDay)
      .sort((a: CalendarEvent, b: CalendarEvent) => a.title.localeCompare(b.title));

    const timed = todayEvents
      .filter((e: CalendarEvent) => !e.isAllDay)
      .sort(
        (a: CalendarEvent, b: CalendarEvent) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );

    let nextOutside: CalendarEvent | null = null;
    if (todayEvents.length === 0) {
      const future = Object.values(events)
        .filter((e: CalendarEvent) => new Date(e.startTime) > now)
        .sort(
          (a: CalendarEvent, b: CalendarEvent) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );
      nextOutside = future[0] ?? null;
    }

    return {
      allDayEvents: allDay,
      timedEvents: timed,
      nextEventOutsideToday: nextOutside,
    };
  }, [events]);

  const allTimedEvents = [...timedEvents];

  const isEmpty = allDayEvents.length === 0 && timedEvents.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Today's Agenda"
      icon={CalendarBlank}
      colSpan={2}
      minHeight="200px"
      priority={1}
      footer={
        <Link
          to="/calendar"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View calendar
          <ArrowRight size={12} />
        </Link>
      }
    >
      {isLoading && Object.keys(events).length === 0 ? (
        <WidgetSkeleton rows={4} variant="timeline" />
      ) : isEmpty ? (
        nextEventOutsideToday ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="text-sm text-muted-foreground">Nothing today.</p>
            <Link
              to={`/calendar?event=${nextEventOutsideToday.id}`}
              className="mt-1 text-sm text-primary hover:text-primary/80 transition-colors"
            >
              Next: {nextEventOutsideToday.title} on{" "}
              {formatDateFull(nextEventOutsideToday.startTime)}
            </Link>
          </div>
        ) : (
          <EmptyWidget
            icon={CalendarBlank}
            title="No events today"
            description="Create one to get started"
            action={{
              label: "Create event",
              onClick: () => navigate("/calendar?new=true"),
            }}
          />
        )
      ) : (
        <div className="space-y-1">
          {allDayEvents.map((event: CalendarEvent) => (
            <EventItem
              key={event.id}
              event={event}
              categoryColor={resolveEventColor(event, categories, calendars)}
              isCurrent={isCurrentEvent(event)}
              isNext={false}
            />
          ))}
          {allDayEvents.length > 0 && timedEvents.length > 0 && (
            <div className="border-t border-border my-2" />
          )}
          {timedEvents.map((event: CalendarEvent) => (
            <EventItem
              key={event.id}
              event={event}
              categoryColor={resolveEventColor(event, categories, calendars)}
              isCurrent={isCurrentEvent(event)}
              isNext={isNextEvent(event, allTimedEvents)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
