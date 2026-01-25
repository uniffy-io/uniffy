/**
 * CurrentTimeIndicator - Line showing current time across all days
 *
 * - Past days: gray dashed line
 * - Today: solid primary line with dot
 * - Future days: primary dashed line
 */

import { useCurrentTime } from '../../hooks';
import type { DayColumn } from '../../types';

interface CurrentTimeIndicatorProps {
  /** Array of day columns to render the indicator across */
  days: DayColumn[];
  /** Top offset in pixels (for grid padding) */
  topOffset?: number;
}

export function CurrentTimeIndicator({
  days,
  topOffset = 0,
}: CurrentTimeIndicatorProps) {
  const { position } = useCurrentTime();

  // Only show if today is in the visible days
  const todayIndex = days.findIndex((day) => day.isToday);
  if (todayIndex === -1) {
    return null;
  }

  const columnCount = days.length;
  const columnWidth = 100 / columnCount;

  return (
    <div
      className="absolute z-20 pointer-events-none flex items-center left-0 right-0"
      style={{ top: topOffset + position }}
    >
      {days.map((day, index) => {
        const isPast = index < todayIndex;
        const isToday = index === todayIndex;
        const isFuture = index > todayIndex;

        return (
          <div
            key={day.dateString}
            className="flex items-center"
            style={{ width: `${columnWidth}%` }}
          >
            {/* Today's dot - at the start of today's column */}
            {isToday && (
              <div className="w-3 h-3 rounded-full -ml-1.5 bg-primary flex-shrink-0" />
            )}

            {/* Line segment */}
            <div
              className={`flex-1 h-0.5 ${
                isPast
                  ? 'bg-muted-foreground/40'
                  : isToday
                  ? 'bg-primary/80'
                  : 'bg-primary/60'
              }`}
              style={{
                backgroundImage: isPast || isFuture
                  ? `repeating-linear-gradient(
                      to right,
                      currentColor,
                      currentColor 4px,
                      transparent 4px,
                      transparent 8px
                    )`
                  : undefined,
                backgroundColor: isPast || isFuture ? 'transparent' : undefined,
                color: isPast ? 'hsl(var(--muted-foreground) / 0.4)' : 'hsl(var(--primary) / 0.6)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * CurrentTimeIndicator for single day view
 */
interface DayCurrentTimeIndicatorProps {
  /** The date to check if we should show the indicator */
  date: Date | string;
  /** Top offset in pixels (for grid padding) */
  topOffset?: number;
  /** Height of each hour block in pixels */
  hourHeight?: number;
}

export function DayCurrentTimeIndicator({
  date,
  topOffset = 0,
  hourHeight,
}: DayCurrentTimeIndicatorProps) {
  const { position } = useCurrentTime(undefined, hourHeight);

  // Check if this date is today
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const isToday = dateObj.toDateString() === today.toDateString();

  if (!isToday) {
    return null;
  }

  return (
    <div
      className="absolute z-20 pointer-events-none flex items-center left-0 right-0"
      style={{ top: topOffset + position }}
    >
      {/* Dot */}
      <div className="w-3 h-3 rounded-full -ml-1.5 bg-primary" />

      {/* Line */}
      <div className="flex-1 h-0.5 bg-primary/80" />
    </div>
  );
}
