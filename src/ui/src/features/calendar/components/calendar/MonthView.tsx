import { useMemo, useState } from "react";
import { useCalendarNavigation, useCalendarEvents } from "@/features/calendar/hooks";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setCurrentDate,
  setViewMode,
  startDrag,
  endDrag,
  updateEventThunk,
} from "@/features/calendar/store";
import { ACCENT_EVENT_COLOR, eventTint } from "@/features/calendar/constants";
import { displayParts, instantFromDisplayParts } from "@/features/calendar/utils";
import { eventDisplayState } from "@/features/calendar/utils/eventDisplay";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";

export function MonthView() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const { monthColumns } = useCalendarNavigation();
  const { getEventsForDate, events } = useCalendarEvents();
  const categories = useAppSelector((state) => state.calendar.categories);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const draggedEventId = useAppSelector((state) => state.calendarUi.draggedEventId);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const weeks = useMemo(() => {
    const result: (typeof monthColumns)[] = [];
    for (let i = 0; i < monthColumns.length; i += 7) {
      result.push(monthColumns.slice(i, i + 7));
    }
    return result;
  }, [monthColumns]);

  const handleDayClick = (dateString: string) => {
    dispatch(setCurrentDate(dateString));
    dispatch(setViewMode("day"));
  };

  const handleDragStart = (e: React.DragEvent, eventId: string) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", eventId);

    dispatch(startDrag(eventId));
  };

  const handleDragEnd = () => {
    dispatch(endDrag());
    setDragOverDate(null);
  };

  const handleDragOver = (e: React.DragEvent, dateString: string) => {
    e.preventDefault();
    if (draggedEventId && dragOverDate !== dateString) {
      setDragOverDate(dateString);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDateStr: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDate(null);

    const eventId = e.dataTransfer.getData("text/plain");
    if (!eventId || eventId !== draggedEventId) return;

    const event = events[eventId];
    if (!event) return;

    // Move date while preserving display-zone time-of-day and duration.
    const oldStart = new Date(event.startTime);
    const oldEnd = new Date(event.endTime);

    const { hours, minutes } = displayParts(oldStart);
    const newStart = instantFromDisplayParts(targetDateStr, hours, minutes);

    const duration = oldEnd.getTime() - oldStart.getTime();
    const newEnd = new Date(newStart.getTime() + duration);

    try {
      await dispatch(
        updateEventThunk({
          eventId,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        }),
      ).unwrap();
    } catch {}

    dispatch(endDrag());
  };

  return (
    <div className="h-full flex flex-col p-2 md:p-4">
      <div className="grid grid-cols-7 border-b border-border mb-1 md:mb-2">
        {/* Labels come from the first grid row so they always follow the week-start setting. */}
        {(weeks[0] ?? []).map((col) => (
          <div
            key={col.dateString}
            className="py-1.5 md:py-2 text-center text-xs md:text-sm font-medium text-muted-foreground"
          >
            {isMobile ? col.dayName.charAt(0) : col.dayName}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-rows-6">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 border-b border-border last:border-b-0">
            {week.map((day) => {
              const dayEvents = getEventsForDate(day.date);
              const maxVisible = isMobile ? 2 : 3;
              const displayEvents = dayEvents.slice(0, maxVisible);
              const moreCount = dayEvents.length - displayEvents.length;

              return (
                <button
                  key={day.dateString}
                  onClick={() => handleDayClick(day.dateString)}
                  onDragOver={(e) => handleDragOver(e, day.dateString)}
                  onDrop={(e) => handleDrop(e, day.dateString)}
                  className={cn(
                    "min-h-[60px] md:min-h-[100px] p-1 md:p-2 text-left border-r border-border last:border-r-0",
                    "hover:bg-muted/50 transition-colors",
                    day.isToday && "bg-primary/5",
                    !day.isCurrentMonth && "bg-muted/30",
                    dragOverDate === day.dateString &&
                      "bg-primary/10 ring-2 ring-inset ring-primary",
                  )}
                >
                  <div className="flex justify-center mb-0.5 md:mb-1">
                    <span
                      className={cn(
                        "w-6 h-6 md:w-7 md:h-7 flex items-center justify-center text-xs md:text-sm rounded-full",
                        day.isToday
                          ? "bg-primary text-primary-foreground font-semibold"
                          : day.isCurrentMonth
                            ? "text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {day.dayNumber}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    {displayEvents.map((event) => {
                      const eventCategory = event.categoryId ? categories[event.categoryId] : null;
                      const eventColor = eventCategory?.color ?? ACCENT_EVENT_COLOR;
                      const attendee = currentUserId
                        ? event.attendees.find((a) => a.id === currentUserId)
                        : null;
                      const declined = attendee?.status === "declined";
                      const pendingOrTentative =
                        attendee != null &&
                        (attendee.status === "pending" || attendee.status === "tentative");
                      const display = eventDisplayState(event);
                      return (
                        <div
                          key={event.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, event.id)}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded truncate cursor-move hover:brightness-95 active:cursor-grabbing",
                            (declined || display.cancelled) && "line-through",
                          )}
                          style={{
                            backgroundColor: eventTint(eventColor, display.free ? 6 : 12),
                            color: eventColor,
                            opacity:
                              declined || display.cancelled
                                ? 0.35
                                : pendingOrTentative || display.tentative
                                  ? 0.6
                                  : 1,
                          }}
                        >
                          {display.title}
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
