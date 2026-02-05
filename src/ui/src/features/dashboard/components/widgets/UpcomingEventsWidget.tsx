/**
 * UpcomingEventsWidget - Shows upcoming calendar events
 *
 * Displays the next 5 events starting from today.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarBlank, MapPin, Clock } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import type { CalendarEvent } from '@/features/calendar/types';

function formatEventTime(event: CalendarEvent): string {
  const start = new Date(event.startTime);
  const now = new Date();
  const isToday = start.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = start.toDateString() === tomorrow.toDateString();

  if (event.isAllDay) {
    if (isToday) return 'Today, All day';
    if (isTomorrow) return 'Tomorrow, All day';
    return start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', All day';
  }

  const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (isToday) return `Today, ${timeStr}`;
  if (isTomorrow) return `Tomorrow, ${timeStr}`;
  return start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + `, ${timeStr}`;
}

function EventListItem({ event, categoryColor }: { event: CalendarEvent; categoryColor: string }) {
  return (
    <Link
      to={`/calendar?event=${event.id}`}
      className={cn(
        'group flex items-start gap-3 rounded-lg p-2 -mx-2 transition-colors',
        'hover:bg-muted/50'
      )}
    >
      {/* Category color indicator */}
      <div
        className="w-1 h-full min-h-[40px] rounded-full flex-shrink-0"
        style={{ backgroundColor: categoryColor }}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {event.title}
        </p>
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

export function UpcomingEventsWidget() {
  const events = useAppSelector((state) => state.calendar?.events ?? {});
  const categories = useAppSelector((state) => state.calendar?.categories ?? {});
  const isLoading = useAppSelector((state) => state.calendar?.loading?.events ?? false);

  // Get upcoming events (next 7 days)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return Object.values(events)
      .filter((event) => {
        const eventDate = new Date(event.startTime);
        return eventDate >= now && eventDate <= weekFromNow;
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 5);
  }, [events]);

  const isEmpty = upcomingEvents.length === 0 && !isLoading;

  // Get category color or default
  const getCategoryColor = (categoryId: string): string => {
    const category = categories[categoryId];
    return category?.color ?? '#f43f5e'; // Default to rose-500
  };

  return (
    <WidgetCard
      title="Upcoming Events"
      subtitle="Your schedule for the week"
      colSpan={2}
      action={
        <Link
          to="/calendar"
          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View calendar
        </Link>
      }
    >
      {isLoading && Object.keys(events).length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={CalendarBlank}
          title="No upcoming events"
          description="Your scheduled events will appear here"
          action={{
            label: 'Create event',
            onClick: () => {
              window.location.href = '/calendar?new=true';
            },
          }}
        />
      ) : (
        <div className="space-y-1">
          {upcomingEvents.map((event) => (
            <EventListItem
              key={event.id}
              event={event}
              categoryColor={getCategoryColor(event.categoryId)}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
