/**
 * AgendaView - Scrollable chronological list of upcoming events grouped by date.
 *
 * Fourth calendar view mode alongside day/week/month.
 * Shows events from today forward in a clean list format.
 */

import { useMemo } from 'react';
import { CalendarBlank, MapPin, Clock, Users, ArrowsClockwise } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectEvent } from '@/features/calendar/store/calendarUiSlice';
import { useCalendarEvents } from '@/features/calendar/hooks';
import { CATEGORY_COLORS } from '@/features/calendar/constants';
import { formatTimeRange } from '@/features/calendar/utils';
import { formatDateWithWeekday } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';

const DEFAULT_COLOR = CATEGORY_COLORS[0].value;

/**
 * Get a display label for a date relative to today.
 */
function getDateLabel(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) {
    return `Today, ${formatDateWithWeekday(dateStr)}`;
  }
  if (date.getTime() === tomorrow.getTime()) {
    return `Tomorrow, ${formatDateWithWeekday(dateStr)}`;
  }
  return formatDateWithWeekday(dateStr);
}

/**
 * Get local date string (YYYY-MM-DD) from ISO timestamp.
 */
function toLocalDateString(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date string is today.
 */
function isToday(dateStr: string): boolean {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dateStr === todayStr;
}

interface DateGroup {
  date: string;
  label: string;
  events: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    location: string;
    categoryColor: string;
    attendeeCount: number;
    isRecurring: boolean;
  }>;
}

export function AgendaView() {
  const dispatch = useAppDispatch();
  const { visibleEvents } = useCalendarEvents();
  const categories = useAppSelector((state) => state.calendar.categories);
  const selectedEventId = useAppSelector((state) => state.calendarUi.selectedEventId);

  const dateGroups = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayStr = toLocalDateString(now.toISOString());

    // Filter events from today forward and sort by start time
    const upcoming = [...visibleEvents]
      .filter((e) => {
        const eventDate = toLocalDateString(e.startTime);
        return eventDate >= todayStr;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Group by date
    const groups = new Map<string, DateGroup>();

    for (const event of upcoming) {
      const dateStr = toLocalDateString(event.startTime);
      if (!groups.has(dateStr)) {
        groups.set(dateStr, {
          date: dateStr,
          label: getDateLabel(dateStr),
          events: [],
        });
      }

      const category = event.categoryId ? categories[event.categoryId] : null;

      groups.get(dateStr)!.events.push({
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        location: event.location,
        categoryColor: category?.color ?? DEFAULT_COLOR,
        attendeeCount: event.attendees.length,
        isRecurring: event.isRecurring ?? false,
      });
    }

    return Array.from(groups.values());
  }, [visibleEvents, categories]);

  if (dateGroups.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
        <CalendarBlank size={48} weight="duotone" className="opacity-40" />
        <p className="text-sm">No upcoming events</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto py-4 px-4 space-y-6">
        {dateGroups.map((group) => {
          const today = isToday(group.date);
          return (
            <div key={group.date}>
              {/* Date header */}
              <div
                className={cn(
                  'sticky top-0 z-10 px-3 py-2 rounded-lg text-sm font-semibold mb-2',
                  today
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted/50 text-foreground'
                )}
              >
                {group.label}
              </div>

              {/* Event cards */}
              <div className="space-y-2">
                {group.events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => dispatch(selectEvent(event.id))}
                    className={cn(
                      'w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors',
                      'hover:bg-muted/50',
                      selectedEventId === event.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card'
                    )}
                  >
                    {/* Category color bar */}
                    <div
                      className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                      style={{ backgroundColor: event.categoryColor }}
                    />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {event.title}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock size={12} weight="duotone" />
                          {event.isAllDay
                            ? 'All day'
                            : formatTimeRange(event.startTime, event.endTime)}
                        </span>
                        {event.location && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin size={12} weight="duotone" />
                            <span className="truncate">{event.location}</span>
                          </span>
                        )}
                        {event.attendeeCount > 1 && (
                          <span className="flex items-center gap-1">
                            <Users size={12} weight="duotone" />
                            {event.attendeeCount}
                          </span>
                        )}
                        {event.isRecurring && (
                          <span className="flex items-center gap-1" title="Recurring event">
                            <ArrowsClockwise size={12} weight="bold" />
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
