/**
 * MonthView - Month calendar grid view
 */

import { useMemo, useState } from 'react';
import { useCalendarNavigation, useCalendarEvents } from '@/features/calendar/hooks';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setCurrentDate, setViewMode, startDrag, endDrag, updateEventThunk } from '@/features/calendar/store';
import { CATEGORY_COLORS } from '@/features/calendar/constants';
import { cn } from '@/shared/utils/cn';

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Default color when category is not found
const DEFAULT_COLOR = CATEGORY_COLORS[0].value; // Blue

export function MonthView() {
  const dispatch = useAppDispatch();
  const { monthColumns } = useCalendarNavigation();
  const { getEventsForDate, events } = useCalendarEvents();
  const categories = useAppSelector((state) => state.calendar.categories);
  const draggedEventId = useAppSelector((state) => state.calendarUi.draggedEventId);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

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

  const handleDragStart = (e: React.DragEvent, eventId: string) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    // Using simple text/plain for compatibility
    e.dataTransfer.setData('text/plain', eventId);
    
    // Set global drag state
    dispatch(startDrag(eventId));
  };

  const handleDragEnd = () => {
    dispatch(endDrag());
    setDragOverDate(null);
  };

  const handleDragOver = (e: React.DragEvent, dateString: string) => {
    e.preventDefault(); // Allow drop
    if (draggedEventId && dragOverDate !== dateString) {
      setDragOverDate(dateString);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);

    const eventId = e.dataTransfer.getData('text/plain');
    if (!eventId || eventId !== draggedEventId) return;

    const event = events[eventId];
    if (!event) return;

    // Calculate new start/end preserving time and duration
    const targetDate = new Date(targetDateStr);
    const oldStart = new Date(event.startTime);
    const oldEnd = new Date(event.endTime);
    
    const newStart = new Date(targetDate);
    newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), oldStart.getSeconds(), oldStart.getMilliseconds());
    
    const duration = oldEnd.getTime() - oldStart.getTime();
    const newEnd = new Date(newStart.getTime() + duration);

    try {
        await dispatch(updateEventThunk({
            eventId,
            startTime: newStart.toISOString(),
            endTime: newEnd.toISOString()
        })).unwrap();
    } catch (error) {
        console.error("Failed to move event", error);
    }
    
    dispatch(endDrag());
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
                  onDragOver={(e) => handleDragOver(e, day.dateString)}
                  onDrop={(e) => handleDrop(e, day.dateString)}
                  className={cn(
                    'min-h-[100px] p-2 text-left border-r border-border last:border-r-0',
                    'hover:bg-muted/50 transition-colors',
                    day.isToday && 'bg-primary/5',
                    !day.isCurrentMonth && 'bg-muted/30',
                    dragOverDate === day.dateString && 'bg-primary/10 ring-2 ring-inset ring-primary'
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
                    {displayEvents.map((event) => {
                      // Look up category color from Redux state
                      const eventCategory = event.categoryId ? categories[event.categoryId] : null;
                      const eventColor = eventCategory?.color ?? DEFAULT_COLOR;
                      return (
                        <div
                          key={event.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, event.id)}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => { e.stopPropagation(); /* Prevent day click */ }}
                          className="text-[10px] px-1.5 py-0.5 rounded truncate cursor-move hover:brightness-95 active:cursor-grabbing"
                          style={{
                            backgroundColor: `${eventColor}20`,
                            color: eventColor,
                          }}
                        >
                          {event.title}
                        </div>
                      );
                    })}

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
