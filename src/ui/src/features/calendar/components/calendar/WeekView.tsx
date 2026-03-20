/**
 * WeekView - Week calendar grid view
 *
 * On desktop/tablet: shows full 7-day week
 * On mobile: shows 3-day view centered on the current date
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEventThunk, openEventModal } from '@/features/calendar/store';
import { useCalendarNavigation, useCalendarEvents } from '@/features/calendar/hooks';
import { TimeColumn, TIME_COLUMN_TOP_PADDING } from '@/features/calendar/components/calendar/TimeColumn';
import { DayHeadersRow } from '@/features/calendar/components/calendar/DayHeader';
import { GridLines } from '@/features/calendar/components/calendar/GridLines';
import { CurrentTimeIndicator } from '@/features/calendar/components/calendar/CurrentTimeIndicator';
import { EventBlock } from '@/features/calendar/components/calendar/EventBlock';
import { GRID, LAYOUT } from '@/features/calendar/constants';
import { positionAllDayEvents } from '@/features/calendar/utils/eventPositioning';
import { selectEvent } from '@/features/calendar/store/calendarUiSlice';
import { cn } from '@/shared/utils/cn';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

export function WeekView() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const draggedEventId = useAppSelector((state) => state.calendarUi.draggedEventId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { weekColumns, currentDate } = useCalendarNavigation();
  const { getPositionedEventsWeek, events } = useCalendarEvents();

  // State for half-hour slot selection
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; hour: number; isHalf: boolean } | null>(null);
  const [dropPreview, setDropPreview] = useState<{ date: string; hour: number; isHalf: boolean } | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  // On mobile, show 3 days centered on currentDate; on desktop show full 7-day week
  const displayColumns = useMemo(() => {
    if (!isMobile) return weekColumns;

    // Find the index of the current date in the week
    const currentIndex = weekColumns.findIndex(col => col.dateString === currentDate);
    if (currentIndex === -1) {
      // Current date not in this week - show first 3 days
      return weekColumns.slice(0, 3);
    }

    // Center on current date: show [prev, current, next]
    const start = Math.max(0, Math.min(currentIndex - 1, weekColumns.length - 3));
    return weekColumns.slice(start, start + 3);
  }, [isMobile, weekColumns, currentDate]);

  const columnCount = displayColumns.length;

  // Get positioned events for the week (always fetch full week, filter display below)
  const weekDates = useMemo(
    () => weekColumns.map((col) => col.date),
    [weekColumns]
  );

  const positionedEventsMap = useMemo(
    () => getPositionedEventsWeek(weekDates),
    [getPositionedEventsWeek, weekDates]
  );

  // All-day events
  const { visibleEvents } = useCalendarEvents();
  const allDayPositions = useMemo(
    () => positionAllDayEvents(visibleEvents, weekDates),
    [visibleEvents, weekDates]
  );
  const allDayMaxRow = allDayPositions.length > 0
    ? Math.max(...allDayPositions.map(p => p.row)) + 1
    : 0;
  const allDayRowHeight = 26;
  const allDaySectionHeight = allDayMaxRow > 0 ? allDayMaxRow * allDayRowHeight + 6 : 0;
  const categories = useAppSelector((state) => state.calendar.categories);
  const selectedEventId = useAppSelector((state) => state.calendarUi.selectedEventId);

  // Calculate grid height
  const hourCount = GRID.END_HOUR - GRID.START_HOUR + 1;
  const gridHeight = hourCount * GRID.HOUR_HEIGHT;

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();

      if (currentHour >= GRID.START_HOUR && currentHour <= GRID.END_HOUR) {
        // Scroll to current hour minus 1 for context
        const scrollTop = (currentHour - GRID.START_HOUR - 1) * GRID.HOUR_HEIGHT;
        scrollRef.current.scrollTop = Math.max(0, scrollTop);
      }
    }
  }, []);

  // Clear selected slot on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedSlot) {
        setSelectedSlot(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedSlot]);

  /**
   * Calculate grid slot from mouse coordinates
   */
  const getSlotFromCoordinates = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current || !scrollRef.current) return null;

    const gridRect = gridRef.current.getBoundingClientRect();
    const clickX = clientX - gridRect.left;
    const columnWidth = gridRect.width / columnCount;
    const columnIndex = Math.floor(clickX / columnWidth);

    if (columnIndex < 0 || columnIndex >= columnCount) return null;

    const scrollRect = scrollRef.current.getBoundingClientRect();
    const clickY = clientY - scrollRect.top + scrollRef.current.scrollTop - TIME_COLUMN_TOP_PADDING;

    if (clickY < 0) return null;

    const halfHourOffset = Math.floor(clickY / GRID.HALF_HOUR_HEIGHT);
    const hour = GRID.START_HOUR + Math.floor(halfHourOffset / 2);
    const isHalf = halfHourOffset % 2 === 1;

    if (hour < GRID.START_HOUR || hour >= GRID.END_HOUR) return null;

    return {
      date: displayColumns[columnIndex].dateString,
      dateObj: displayColumns[columnIndex].date,
      hour,
      isHalf,
      columnIndex
    };
  }, [displayColumns, columnCount]);

  /**
   * Handle drag over to show preview
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); // Allow dropping

    if (!draggedEventId) return;

    const slot = getSlotFromCoordinates(e.clientX, e.clientY);
    if (slot) {
      setDropPreview({
        date: slot.date,
        hour: slot.hour,
        isHalf: slot.isHalf
      });
    } else {
      setDropPreview(null);
    }
  }, [draggedEventId, getSlotFromCoordinates]);

  /**
   * Handle drop to reschedule event
   */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDropPreview(null);

    if (!draggedEventId) return;

    const slot = getSlotFromCoordinates(e.clientX, e.clientY);
    if (!slot) return;

    // Calculate new start time
    const newStartDate = new Date(slot.dateObj);
    newStartDate.setHours(slot.hour, slot.isHalf ? 30 : 0, 0, 0);

    let eventToUpdate = null;
    for (const evts of positionedEventsMap.values()) {
      const found = evts.find(e => e.id === draggedEventId);
      if (found) {
        eventToUpdate = found;
        break;
      }
    }

    if (!eventToUpdate) return;

    // Calculate duration
    const start = new Date(eventToUpdate.startTime);
    const end = new Date(eventToUpdate.endTime);
    const durationMs = end.getTime() - start.getTime();

    const newStartTime = newStartDate.toISOString();
    const newEndTime = new Date(newStartDate.getTime() + durationMs).toISOString();

    try {
      await dispatch(updateEventThunk({
        eventId: draggedEventId,
        startTime: newStartTime,
        endTime: newEndTime,
      })).unwrap();
    } catch (error) {
      console.error('Failed to reschedule event:', error);
    }
  }, [draggedEventId, getSlotFromCoordinates, positionedEventsMap, dispatch]);

  /**
   * Handle clicks on empty grid cells - select half-hour slots
   */
  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Only handle clicks on empty grid area (not on events or other interactive elements)
    if (
      target.closest('[data-event-block]') ||
      target.closest('[data-event]') ||
      target.closest('button') ||
      target.closest('a')
    ) {
      return;
    }

    const slot = getSlotFromCoordinates(e.clientX, e.clientY);
    if (!slot) return;

    const { date, hour, isHalf, dateObj } = slot;
    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTimeRef.current < 300 &&
                          selectedSlot?.date === date &&
                          selectedSlot?.hour === hour &&
                          selectedSlot?.isHalf === isHalf;

    if (isDoubleClick) {
      // Double-click: open event creation modal with prefilled date/time
      const clickedHour = hour + (isHalf ? 0.5 : 0);
      const startMinutes = Math.round((clickedHour % 1) * 60);
      const endHourVal = clickedHour + 1;
      const endMinutes = Math.round((endHourVal % 1) * 60);

      const startDt = new Date(dateObj);
      startDt.setHours(Math.floor(clickedHour), startMinutes, 0, 0);
      const endDt = new Date(dateObj);
      endDt.setHours(Math.floor(endHourVal), endMinutes, 0, 0);

      dispatch(openEventModal({
        mode: 'create',
        prefill: {
          date: date,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
        },
      }));
      setSelectedSlot(null);
    } else {
      // Single click: select slot
      setSelectedSlot({ date, hour, isHalf });
      lastClickTimeRef.current = currentTime;
    }
  };

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Day headers container - use same flex structure as grid below */}
        <div className="flex border-b border-border flex-shrink-0 min-w-0 overflow-y-scroll invisible-scrollbar">
          {/* Time column header spacer */}
          <div
            className="flex-shrink-0 bg-muted/50 border-r border-border"
            style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
          />

          {/* Day headers */}
          <DayHeadersRow days={displayColumns} />
        </div>

        {/* All-day events bar */}
        {allDaySectionHeight > 0 && (
          <div className="flex border-b border-border flex-shrink-0 min-w-0">
            <div
              className="flex-shrink-0 border-r border-border flex items-center justify-center"
              style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
            >
              <span className="text-[10px] text-muted-foreground">All day</span>
            </div>
            <div className="flex-1 relative" style={{ height: allDaySectionHeight }}>
              {allDayPositions
                .filter(({ startColumn, spanColumns }) => {
                  // Only show events that overlap with displayed columns
                  const displayStart = weekColumns.indexOf(displayColumns[0]);
                  const displayEnd = displayStart + displayColumns.length;
                  return startColumn < displayEnd && startColumn + spanColumns > displayStart;
                })
                .map(({ event, startColumn, spanColumns, row }) => {
                  // Adjust column positions for mobile 3-day view
                  const displayStart = weekColumns.indexOf(displayColumns[0]);
                  const adjustedStart = Math.max(0, startColumn - displayStart);
                  const adjustedEnd = Math.min(columnCount, startColumn + spanColumns - displayStart);
                  const adjustedSpan = adjustedEnd - adjustedStart;
                  if (adjustedSpan <= 0) return null;

                  const category = event.categoryId ? categories[event.categoryId] : null;
                  const color = category?.color ?? '#3B82F6';
                  const isSelected = selectedEventId === event.id;

                  return (
                    <button
                      key={event.id}
                      onClick={() => dispatch(selectEvent(event.id))}
                      className={cn(
                        'absolute text-left text-xs truncate px-2 py-0.5 rounded transition-colors',
                        'hover:brightness-90',
                        isSelected && 'ring-2 ring-primary'
                      )}
                      style={{
                        left: `${(adjustedStart / columnCount) * 100}%`,
                        width: `${(adjustedSpan / columnCount) * 100 - 0.5}%`,
                        top: row * allDayRowHeight + 3,
                        height: allDayRowHeight - 4,
                        backgroundColor: `${color}20`,
                        color: color,
                        borderLeft: `3px solid ${color}`,
                      }}
                      title={event.title}
                    >
                      {event.title}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Scrollable grid area */}
        <div ref={scrollRef} className="flex-1 overflow-y-scroll overflow-x-auto min-w-0">
          <div className="flex min-w-full">
            {/* Time column */}
            <TimeColumn />

            {/* Grid columns */}
            <div
              ref={gridRef}
              className="flex-1 relative cursor-pointer select-none"
              style={{ minHeight: gridHeight + TIME_COLUMN_TOP_PADDING }}
              onClick={handleGridClick}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* Grid lines */}
              <GridLines columnCount={columnCount} hourCount={hourCount} topOffset={TIME_COLUMN_TOP_PADDING} />

              {/* Drop Preview */}
              {dropPreview && (
                <div
                  className="absolute bg-primary/30 border border-primary pointer-events-none z-30 transition-all duration-75 rounded"
                  style={{
                    left: `${((displayColumns.findIndex(col => col.dateString === dropPreview.date)) / columnCount) * 100}%`,
                    width: `${95 / columnCount}%`,
                    marginLeft: '2px',
                    top: `${TIME_COLUMN_TOP_PADDING + (dropPreview.hour - GRID.START_HOUR) * GRID.HOUR_HEIGHT + (dropPreview.isHalf ? GRID.HALF_HOUR_HEIGHT : 0)}px`,
                    height: draggedEventId && events[draggedEventId]
                      ? `${((new Date(events[draggedEventId].endTime).getTime() - new Date(events[draggedEventId].startTime).getTime()) / (1000 * 60 * 60)) * GRID.HOUR_HEIGHT}px`
                      : `${GRID.HALF_HOUR_HEIGHT * 2}px`,
                  }}
                />
              )}

              {/* Selected half-hour slot indicator */}
              {selectedSlot && (
                <div
                  className="absolute bg-primary/20 border-2 border-primary pointer-events-none"
                  style={{
                    left: `${((displayColumns.findIndex(col => col.dateString === selectedSlot.date)) / columnCount) * 100}%`,
                    width: `${100 / columnCount}%`,
                    top: `${TIME_COLUMN_TOP_PADDING + (selectedSlot.hour - GRID.START_HOUR) * GRID.HOUR_HEIGHT + (selectedSlot.isHalf ? GRID.HALF_HOUR_HEIGHT : 0)}px`,
                    height: `${GRID.HALF_HOUR_HEIGHT}px`,
                  }}
                />
              )}

              {/* Today highlight */}
              {displayColumns.map((day, index) => (
                day.isToday && (
                  <div
                    key={`today-${day.dateString}`}
                    className="absolute bg-primary/5 pointer-events-none"
                    style={{
                      left: `${(index / columnCount) * 100}%`,
                      width: `${100 / columnCount}%`,
                      top: TIME_COLUMN_TOP_PADDING,
                      bottom: 0,
                    }}
                  />
                )
              ))}

              {/* Events */}
              {displayColumns.map((day, columnIndex) => {
                const dayEvents = positionedEventsMap.get(day.dateString) || [];
                const colWidth = 100 / columnCount;
                const columnLeft = columnIndex * colWidth;

                return (
                  <div
                    key={day.dateString}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${columnLeft}%`,
                      width: `${colWidth}%`,
                      top: TIME_COLUMN_TOP_PADDING,
                      height: gridHeight,
                    }}
                  >
                    {dayEvents.map((event) => (
                      <div
                        key={event.id}
                        data-event-block
                        className="pointer-events-auto"
                      >
                        <EventBlock event={event} columnWidth={100} />
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Current time indicator - spans displayed days */}
              <CurrentTimeIndicator
                days={displayColumns}
                topOffset={TIME_COLUMN_TOP_PADDING}
              />
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
