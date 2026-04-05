/**
 * Single event row for the today's meetings quick view panel.
 * Shows time, title, location/attendees, and optional join button.
 */

import { MapPin, VideoCamera, Users } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatTime } from '@/features/calendar/utils';
import { getCategoryColor } from '@/features/calendar/constants';
import type { CalendarEvent } from '@/features/calendar/types';

function formatCountdown(targetMs: number, nowMs: number): string {
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'now';

  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) return `in ${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `in ${hours}h`;
  return `in ${hours}h ${minutes}m`;
}

interface TodayEventItemProps {
  event: CalendarEvent;
  isCurrent?: boolean;
  now: Date;
  onClick: (event: CalendarEvent) => void;
}

function AttendeesSummary({ event }: { event: CalendarEvent }) {
  const count = event.attendees.length;
  if (count === 0) return null;

  if (count <= 2) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
        <Users size={12} className="shrink-0" />
        {event.attendees.map((a) => a.name.split(' ')[0]).join(', ')}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Users size={12} className="shrink-0" />
      {event.attendees[0].name.split(' ')[0]} +{count - 1}
    </span>
  );
}

function ContextLine({ event }: { event: CalendarEvent }) {
  if (event.location) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
        <MapPin size={12} className="shrink-0" />
        <span className="truncate">{event.location}</span>
      </span>
    );
  }

  if (event.roomName) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
        <MapPin size={12} className="shrink-0" />
        <span className="truncate">{event.roomName}</span>
      </span>
    );
  }

  return <AttendeesSummary event={event} />;
}

export function TodayEventItem({ event, isCurrent, now, onClick }: TodayEventItemProps) {
  const categoryColor = getCategoryColor(event.categoryId);
  const nowMs = now.getTime();
  const startMs = new Date(event.startTime).getTime();
  const endMs = new Date(event.endTime).getTime();

  const startLabel = formatTime(event.startTime);
  const endLabel = formatTime(event.endTime);
  const timeRange = event.isAllDay ? 'All day' : `${startLabel} - ${endLabel}`;

  let countdown: string | null = null;
  if (!event.isAllDay) {
    if (isCurrent) {
      countdown = `ends ${formatCountdown(endMs, nowMs)}`;
    } else {
      countdown = formatCountdown(startMs, nowMs);
    }
  }

  return (
    <button
      onClick={() => onClick(event)}
      className={cn(
        'group w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors',
        'hover:bg-muted/50',
        isCurrent && 'bg-primary/5'
      )}
    >
      {/* Category color bar */}
      <div
        className={cn(
          'w-0.5 shrink-0 rounded-full mt-0.5',
          isCurrent ? 'h-full min-h-[40px]' : 'h-full min-h-[36px]'
        )}
        style={{ backgroundColor: categoryColor }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Time row: range + countdown */}
        <div className="flex items-center gap-1.5 mb-0.5">
          {isCurrent && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
            </span>
          )}
          <span className="text-[11px] font-medium text-muted-foreground">
            {timeRange}
          </span>
          {countdown && (
            <>
              <span className="text-[11px] text-muted-foreground/40">·</span>
              <span className={cn(
                'text-[11px] font-medium',
                isCurrent ? 'text-rose-500 dark:text-rose-400' : 'text-primary'
              )}>
                {countdown}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-foreground truncate leading-snug">
          {event.title}
        </p>

        {/* Context line */}
        <div className="mt-0.5">
          <ContextLine event={event} />
        </div>
      </div>

      {/* Join button */}
      {event.meetingUrl && (
        <a
          href={event.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium mt-0.5',
            'transition-colors',
            isCurrent
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
          )}
        >
          <VideoCamera size={12} weight="fill" />
          Join
        </a>
      )}
    </button>
  );
}
