/**
 * MonthView - Month calendar grid view
 */

import { useMemo } from 'react';
import { useCalendarNavigation, useCalendarEvents } from '../../hooks';
import { useAppDispatch } from '@/app/hooks';
import { setCurrentDate, setViewMode } from '../../store';
import { getCategoryColor } from '../../constants';
import { cn } from '@/utils/cn';

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthView() {
  const dispatch = useAppDispatch();
  const { monthColumns } = useCalendarNavigation();
  const { getEventsForDate } = useCalendarEvents();

  // Group days into weeks
  const weeks = useMemo(() => {
    const result: typeof monthColumns[] = [];
    for (let i = 0; i < monthColumns.length; i += 7) {
      result.push(monthColumns.slice(i, i + 7));
    }
    return result;
  }, [monthColumns]);

  const handleDayClick = (dateString: string) => {
    dispatch(setCurrentDate(dateString));
    dispatch(setViewMode('day'));
  };

  return (
    <div className="h-full flex flex-col p-4">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border mb-2">
        {DAY_HEADERS.map((day) => (
          <div
            key={day}
            className="py-2 text-center text-sm font-medium text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-rows-6">
        {weeks.map((week, weekIndex) => (
          <div
            key={weekIndex}
            className="grid grid-cols-7 border-b border-border last:border-b-0"
          >
            {week.map((day) => {
              const dayEvents = getEventsForDate(day.date);
              const displayEvents = dayEvents.slice(0, 3);
              const moreCount = dayEvents.length - displayEvents.length;

              return (
                <button
                  key={day.dateString}
                  onClick={() => handleDayClick(day.dateString)}
                  className={cn(
                    'min-h-[100px] p-2 text-left border-r border-border last:border-r-0',
                    'hover:bg-muted/50 transition-colors',
                    day.isToday && 'bg-primary/5',
                    !day.isCurrentMonth && 'bg-muted/30'
                  )}
                >
                  {/* Day number */}
                  <div className="flex justify-center mb-1">
                    <span
                      className={cn(
                        'w-7 h-7 flex items-center justify-center text-sm rounded-full',
                        day.isToday
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : day.isCurrentMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      )}
                    >
                      {day.dayNumber}
                    </span>
                  </div>

                  {/* Events */}
                  <div className="space-y-0.5">
                    {displayEvents.map((event) => (
                      <div
                        key={event.id}
                        className="text-[10px] px-1.5 py-0.5 rounded truncate"
                        style={{
                          backgroundColor: `${getCategoryColor(
                            event.categoryId
                          )}20`,
                          color: getCategoryColor(event.categoryId),
                        }}
                      >
                        {event.title}
                      </div>
                    ))}

                    {moreCount > 0 && (
                      <div className="text-[10px] text-muted-foreground px-1.5">
                        +{moreCount} more
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
