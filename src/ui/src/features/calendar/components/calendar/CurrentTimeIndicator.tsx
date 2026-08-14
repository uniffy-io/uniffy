import { useCurrentTime } from "@/features/calendar/hooks";
import type { DayColumn } from "@/features/calendar/types";

interface CurrentTimeIndicatorProps {
  days: DayColumn[];
  topOffset?: number;
}

export function CurrentTimeIndicator({ days, topOffset = 0 }: CurrentTimeIndicatorProps) {
  const { position } = useCurrentTime();

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
            {isToday && <div className="w-3 h-3 rounded-full -ml-1.5 bg-primary flex-shrink-0" />}

            <div
              className={`flex-1 h-0.5 ${
                isPast ? "bg-muted-foreground/40" : isToday ? "bg-primary/80" : "bg-primary/60"
              }`}
              style={{
                backgroundImage:
                  isPast || isFuture
                    ? `repeating-linear-gradient(
                      to right,
                      currentColor,
                      currentColor 4px,
                      transparent 4px,
                      transparent 8px
                    )`
                    : undefined,
                backgroundColor: isPast || isFuture ? "transparent" : undefined,
                color: isPast ? "hsl(var(--muted-foreground) / 0.4)" : "hsl(var(--primary) / 0.6)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

interface DayCurrentTimeIndicatorProps {
  date: Date | string;
  topOffset?: number;
  hourHeight?: number;
}

export function DayCurrentTimeIndicator({
  date,
  topOffset = 0,
  hourHeight,
}: DayCurrentTimeIndicatorProps) {
  const { position } = useCurrentTime(undefined, hourHeight);

  const dateObj = typeof date === "string" ? new Date(date) : date;
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
      <div className="w-3 h-3 rounded-full -ml-1.5 bg-primary" />

      <div className="flex-1 h-0.5 bg-primary/80" />
    </div>
  );
}
