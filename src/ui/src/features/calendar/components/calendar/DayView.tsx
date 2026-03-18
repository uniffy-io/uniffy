/**
 * DayView - Single day calendar view
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEventThunk, openEventModal } from '@/features/calendar/store';
import { useCalendarNavigation, useCalendarEvents } from '@/features/calendar/hooks';
import { TimeColumn, TIME_COLUMN_TOP_PADDING } from '@/features/calendar/components/calendar/TimeColumn';
import { DayHeader } from '@/features/calendar/components/calendar/DayHeader';
import { GridLines } from '@/features/calendar/components/calendar/GridLines';
import { DayCurrentTimeIndicator } from '@/features/calendar/components/calendar/CurrentTimeIndicator';
import { EventBlock } from '@/features/calendar/components/calendar/EventBlock';
import { GRID, LAYOUT } from '@/features/calendar/constants';
import { parseISO, format } from '@/features/calendar/utils';

export function DayView() {
  const dispatch = useAppDispatch();
  const draggedEventId = useAppSelector((state) => state.calendarUi.draggedEventId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { currentDate } = useCalendarNavigation();
  const { getPositionedEvents } = useCalendarEvents();

  // State for half-hour slot selection
  const [selectedSlot, setSelectedSlot] = useState<{ hour: number; isHalf: boolean } | null>(null);
  const [dropPreview, setDropPreview] = useState<{ hour: number; isHalf: boolean } | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  const currentDateObj = useMemo(() => parseISO(currentDate), [currentDate]);

  // Create a day column for the header
  const dayColumn = useMemo(
    () => ({
      date: currentDateObj,
      dayOfWeek: currentDateObj.getDay(),
      dayName: format(currentDateObj, 'EEEE'),
      dayNumber: currentDateObj.getDate(),
      isToday: new Date().toDateString() === currentDateObj.toDateString(),
      isCurrentMonth: true,
      isWeekend: [0, 6].includes(currentDateObj.getDay()),
      dateString: currentDate,
    }),
    [currentDateObj, currentDate]
  );

  // Get positioned events for the day
  const positionedEvents = useMemo(
    () => getPositionedEvents(currentDate),
    [getPositionedEvents, currentDate]
  );

  // Calculate grid height (taller for day view)
  const hourCount = GRID.END_HOUR - GRID.START_HOUR + 1;
  const hourHeight = 80; // Taller hours for day view
  const gridHeight = hourCount * hourHeight;

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();

      if (currentHour >= GRID.START_HOUR && currentHour <= GRID.END_HOUR) {
        const scrollTop = (currentHour - GRID.START_HOUR - 1) * hourHeight;
        scrollRef.current.scrollTop = Math.max(0, scrollTop);
      }
    }
  }, [hourHeight]);

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
  const getSlotFromCoordinates = useCallback((clientY: number) => {
    if (!gridRef.current || !scrollRef.current) return null;

    const scrollRect = scrollRef.current.getBoundingClientRect();
    const clickY = clientY - scrollRect.top + scrollRef.current.scrollTop - TIME_COLUMN_TOP_PADDING;
    
    if (clickY < 0) return null;

    const halfHourSlotHeight = hourHeight / 2;
    const halfHourOffset = Math.floor(clickY / halfHourSlotHeight);
    const hour = GRID.START_HOUR + Math.floor(halfHourOffset / 2);
    const isHalf = halfHourOffset % 2 === 1;

    if (hour < GRID.START_HOUR || hour >= GRID.END_HOUR) return null;

    return { hour, isHalf };
  }, [hourHeight]);

  /**
   * Handle drag over to show preview
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); // Allow dropping
    
    if (!draggedEventId) return;

    const slot = getSlotFromCoordinates(e.clientY);
    if (slot) {
      setDropPreview(slot);
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

    const slot = getSlotFromCoordinates(e.clientY);
    if (!slot) return;

    // Calculate new start time
    const newStartDate = new Date(currentDate);
    newStartDate.setHours(slot.hour, slot.isHalf ? 30 : 0, 0, 0);

    const match = positionedEvents.find(e => e.id === draggedEventId);
    if (!match) return;

    const start = new Date(match.startTime);
    const end = new Date(match.endTime);
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
  }, [draggedEventId, getSlotFromCoordinates, currentDate, positionedEvents, dispatch]);

  /**
   * Handle clicks on empty grid cells - select half-hour slots
   */
  const handleGridClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Only handle clicks on empty grid area
    if (
      target.closest('[data-event-block]') ||
      target.closest('[data-event]') ||
      target.closest('button') ||
      target.closest('a')
    ) {
      return;
    }

    const slot = getSlotFromCoordinates(e.clientY);
    if (!slot) return;
    
    const { hour, isHalf } = slot;
    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTimeRef.current < 300 && 
                          selectedSlot?.hour === hour && 
                          selectedSlot?.isHalf === isHalf;

    if (isDoubleClick) {
      // Double-click: open event creation modal with prefilled date/time
      const clickedHour = hour + (isHalf ? 0.5 : 0);
      const startMinutes = Math.round((clickedHour % 1) * 60);
      const endHourVal = clickedHour + 1;
      const endMinutes = Math.round((endHourVal % 1) * 60);

      const dayDate = parseISO(currentDate);
      const startDt = new Date(dayDate);
      startDt.setHours(Math.floor(clickedHour), startMinutes, 0, 0);
      const endDt = new Date(dayDate);
      endDt.setHours(Math.floor(endHourVal), endMinutes, 0, 0);

      const dateStr = format(dayDate, 'yyyy-MM-dd');
      dispatch(openEventModal({
        mode: 'create',
        prefill: {
          date: dateStr,
          startTime: startDt.toISOString(),
          endTime: endDt.toISOString(),
        },
      }));
      setSelectedSlot(null);
    } else {
      // Single click: select slot
      setSelectedSlot({ hour, isHalf });
      lastClickTimeRef.current = currentTime;
    }
  };

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Day header */}
        <div className="flex border-b border-border flex-shrink-0">
          {/* Time column header spacer */}
          <div
            className="flex-shrink-0 bg-muted/50 border-r border-border"
            style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
          />

          {/* Day header */}
          <div className="flex-1 flex justify-center">
            <DayHeader day={dayColumn} />
          </div>
        </div>

        {/* Scrollable grid area */}
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <div className="flex">
            {/* Time column */}
            <TimeColumn hourHeight={hourHeight} />

            {/* Grid column */}
            <div
              ref={gridRef}
              className="flex-1 relative cursor-pointer select-none"
              style={{ minHeight: gridHeight + TIME_COLUMN_TOP_PADDING }}
              onClick={handleGridClick}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* Grid lines */}
              <GridLines columnCount={1} hourCount={hourCount} topOffset={TIME_COLUMN_TOP_PADDING} hourHeight={hourHeight} />

              {/* Selected half-hour slot indicator */}
              {selectedSlot && (
                <div
                  className="absolute w-full bg-primary/20 border-2 border-primary pointer-events-none"
                  style={{
                    top: `${TIME_COLUMN_TOP_PADDING + (selectedSlot.hour - GRID.START_HOUR) * hourHeight + (selectedSlot.isHalf ? hourHeight / 2 : 0)}px`,
                    height: `${hourHeight / 2}px`,
                  }}
                />
              )}

              {/* Drop Preview Ghost */}
              {dropPreview && draggedEventId && (
                <div
                  className="absolute bg-primary/20 border-2 border-dashed border-primary z-20 pointer-events-none rounded transition-all duration-75"
                  style={{
                    top: `${TIME_COLUMN_TOP_PADDING + (dropPreview.hour - GRID.START_HOUR) * hourHeight + (dropPreview.isHalf ? hourHeight / 2 : 0)}px`,
                    height: positionedEvents.find(e => e.id === draggedEventId) 
                      ? `${(positionedEvents.find(e => e.id === draggedEventId)!.height / GRID.HOUR_HEIGHT) * hourHeight}px`
                      : `${hourHeight}px`,
                    left: 0,
                    right: 0,
                  }}
                />
              )}

              {/* Today highlight */}
              {dayColumn.isToday && (
                <div
                  className="absolute inset-x-0 bg-primary/5 pointer-events-none"
                  style={{ top: TIME_COLUMN_TOP_PADDING, bottom: 0 }}
                />
              )}

              {/* Events */}
              {positionedEvents.map((event) => (
                <div
                  key={event.id}
                  data-event-block
                  className="pointer-events-auto"
                >
                  <EventBlock
                    event={{
                      ...event,
                      // Adjust for taller hour height and top padding
                      top: TIME_COLUMN_TOP_PADDING + (event.top / GRID.HOUR_HEIGHT) * hourHeight,
                      height: (event.height / GRID.HOUR_HEIGHT) * hourHeight,
                    }}
                    columnWidth={100}
                  />
                </div>
              ))}

              {/* Current time indicator */}
              <DayCurrentTimeIndicator date={currentDate} topOffset={TIME_COLUMN_TOP_PADDING} hourHeight={hourHeight} />
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
