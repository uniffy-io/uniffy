// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from 'react';
import {
  Clock,
  ArrowSquareOut,
  CopySimple,
  Check,
  CalendarDots,
  MapPin,
  VideoCamera,
} from '@phosphor-icons/react';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { CalendarTemporalIndicator } from '@/components/mention/LiveIndicators';
import type { MentionLiveState } from '@/components/mention/types';

interface CalendarMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

function formatEventTimeRange(startStr: string, endStr?: string, isAllDay?: boolean): string {
  const start = new Date(startStr);
  const end = endStr ? new Date(endStr) : null;
  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

  if (isAllDay) {
    if (!end || start.toDateString() === end.toDateString()) {
      return `${start.toLocaleDateString(undefined, dateOpts)} (all day)`;
    }
    return `${start.toLocaleDateString(undefined, dateOpts)} - ${end.toLocaleDateString(undefined, dateOpts)} (all day)`;
  }

  const startDate = start.toLocaleDateString(undefined, dateOpts);
  const startTime = start.toLocaleTimeString(undefined, timeOpts);
  if (!end) return `${startDate} at ${startTime}`;

  const endTime = end.toLocaleTimeString(undefined, timeOpts);
  if (start.toDateString() === end.toDateString()) {
    return `${startDate}, ${startTime} - ${endTime}`;
  }

  const endDate = end.toLocaleDateString(undefined, dateOpts);
  return `${startDate} ${startTime} - ${endDate} ${endTime}`;
}

export function CalendarMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: CalendarMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  return (
    <>
      <span className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-rose-500/10 via-rose-500/5 to-transparent pointer-events-none" />

      <span className="block relative px-4 pr-10 pt-3.5 pb-1.5 pl-5">
        <span className="flex items-start gap-3">
          <span className="grid place-items-center shrink-0 w-10 h-10 rounded-lg border border-primary/55 bg-primary/10 text-primary">
            <CalendarDots size={18} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Event</span>
              {liveState.eventStartTime && (
                <>
                  <span className="text-muted-foreground/40">.</span>
                  <CalendarTemporalIndicator
                    startTime={liveState.eventStartTime}
                    endTime={liveState.eventEndTime}
                    isAllDay={liveState.eventIsAllDay}
                  />
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {liveState.eventStartTime && (
        <span className="block px-4 pb-2 pl-5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock size={13} weight="duotone" className="text-rose-500 shrink-0" />
            <span>{formatEventTimeRange(liveState.eventStartTime, liveState.eventEndTime, liveState.eventIsAllDay)}</span>
          </span>
        </span>
      )}

      {liveState.eventLocation && (
        <span className="block px-4 pb-2 pl-5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin size={13} weight="duotone" className="text-rose-500 shrink-0" />
            <span className="truncate">{liveState.eventLocation}</span>
          </span>
        </span>
      )}

      {liveState.eventMeetingUrl && (
        <span className="block px-4 pb-2 pl-5">
          <a
            href={liveState.eventMeetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <VideoCamera size={13} weight="duotone" />
            <span>Join meeting</span>
          </a>
        </span>
      )}

      {description && (
        <span className="block px-4 pb-2.5 pl-5">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-2">{description}</span>
        </span>
      )}

      <span className="flex px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(liveState.updatedAt) || 'No date'}</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy URN"
          >
            {copied ? <Check size={12} weight="bold" className="text-green-500" /> : <CopySimple size={12} weight="bold" />}
          </button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </span>
        </span>
      </span>
    </>
  );
}
