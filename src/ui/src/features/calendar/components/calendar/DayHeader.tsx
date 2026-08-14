import type { DayColumn } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";

interface DayHeaderProps {
  day: DayColumn;
}

export function DayHeader({ day }: DayHeaderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-2">
      <span
        className={cn(
          "text-xs font-medium",
          day.isToday ? "text-primary" : "text-muted-foreground",
        )}
      >
        {day.dayName}
      </span>

      <span
        className={cn(
          "w-9 h-9 flex items-center justify-center text-lg font-medium rounded-full",
          day.isToday
            ? "bg-primary text-primary-foreground"
            : "text-foreground hover:bg-muted transition-colors",
        )}
      >
        {day.dayNumber}
      </span>
    </div>
  );
}

interface DayHeadersRowProps {
  days: DayColumn[];
}

export function DayHeadersRow({ days }: DayHeadersRowProps) {
  const columnCount = days.length;

  return (
    <div className="relative flex flex-1 h-full">
      {days.map((day) => (
        <div key={day.dateString} className="flex-1 min-w-0">
          <DayHeader day={day} />
        </div>
      ))}

      {/* Dividers mirror GridLines positioning for pixel alignment. */}
      {Array.from({ length: columnCount - 1 }).map((_, i) => (
        <div
          key={`divider-${i}`}
          className="absolute top-0 bottom-0 border-l border-border"
          style={{ left: `${((i + 1) / columnCount) * 100}%` }}
        />
      ))}
    </div>
  );
}
