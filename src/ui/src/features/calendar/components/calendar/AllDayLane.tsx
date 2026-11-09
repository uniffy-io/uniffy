import { useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { LAYOUT, eventTint } from "@/features/calendar/constants";
import type { CalendarEvent, DayColumn } from "@/features/calendar/types";
import { eventDisplayState } from "@/features/calendar/utils/eventDisplay";
import { positionAllDayEvents } from "@/features/calendar/utils/eventPositioning";
import { resolveEventColor } from "@/features/calendar/utils/eventColor";
import { selectEvent } from "@/features/calendar/store/calendarUiSlice";
import { cn } from "@/shared/utils/cn";

const ROW_HEIGHT = 26;

interface AllDayLaneProps {
  events: CalendarEvent[];
  /** Every column of the period, so spans clamp to it. */
  columns: DayColumn[];
  /** The columns on screen; a phone shows a window of the week. */
  displayColumns?: DayColumn[];
}

export function AllDayLane({ events, columns, displayColumns = columns }: AllDayLaneProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const calendars = useAppSelector((state) => state.calendar.calendars);
  const selectedEventId = useAppSelector((state) => state.calendarUi.selectedEventId);

  const positions = useMemo(
    () =>
      positionAllDayEvents(
        events,
        columns.map((column) => column.date),
      ),
    [events, columns],
  );

  const displayStart = Math.max(0, columns.indexOf(displayColumns[0]));
  const columnCount = displayColumns.length;
  const visible = positions.filter(
    ({ startColumn, spanColumns }) =>
      startColumn < displayStart + columnCount && startColumn + spanColumns > displayStart,
  );
  if (visible.length === 0 || columnCount === 0) return null;

  const rows = Math.max(...visible.map((p) => p.row)) + 1;

  return (
    <div className="flex border-b border-border flex-shrink-0 min-w-0">
      <div
        className="flex-shrink-0 border-r border-border flex items-center justify-center"
        style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
      >
        <span className="text-[10px] text-muted-foreground">All day</span>
      </div>
      <div className="flex-1 relative" style={{ height: rows * ROW_HEIGHT + 6 }}>
        {visible.map(({ event, startColumn, spanColumns, row }) => {
          const start = Math.max(0, startColumn - displayStart);
          const end = Math.min(columnCount, startColumn + spanColumns - displayStart);
          const span = end - start;
          if (span <= 0) return null;

          const color = resolveEventColor(event, categories, calendars);
          const display = eventDisplayState(event);

          return (
            <button
              key={event.id}
              onClick={() => dispatch(selectEvent(event.id))}
              className={cn(
                "absolute text-left text-xs truncate px-2 py-0.5 rounded transition-colors",
                "hover:brightness-90",
                selectedEventId === event.id && "ring-2 ring-primary",
                display.cancelled && "line-through opacity-50",
                display.tentative && "opacity-60",
              )}
              style={{
                left: `${(start / columnCount) * 100}%`,
                width: `${(span / columnCount) * 100 - 0.5}%`,
                top: row * ROW_HEIGHT + 3,
                height: ROW_HEIGHT - 4,
                backgroundColor: eventTint(color, display.free ? 6 : 12),
                color: color,
                borderLeft: `3px solid ${color}`,
                borderLeftStyle: display.outOfOffice ? "dashed" : "solid",
              }}
              title={display.title}
            >
              {display.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
