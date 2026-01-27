/**
 * WeekView - Week calendar grid view
 */

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { updateEventThunk } from '../../store';
import { useCalendarNavigation, useCalendarEvents } from '../../hooks';
import { TimeColumn, TIME_COLUMN_TOP_PADDING } from './TimeColumn';
import { DayHeadersRow } from './DayHeader';
import { GridLines } from './GridLines';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { EventBlock } from './EventBlock';
import { QuickEventModal } from '../modals/QuickEventModal';
import { GRID, LAYOUT } from '../../constants';

export function WeekView() {
  const dispatch = useAppDispatch();
  const draggedEventId = useAppSelector((state) => state.calendarUi.draggedEventId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { weekColumns } = useCalendarNavigation();
  const { getPositionedEventsWeek, events } = useCalendarEvents();
  const [showQuickEventModal, setShowQuickEventModal] = useState(false);
  const [modalDate, setModalDate] = useState(new Date());
  const [modalStartHour, setModalStartHour] = useState(9);
  const [modalEndHour, setModalEndHour] = useState(10);

  // State for half-hour slot selection
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; hour: number; isHalf: boolean } | null>(null);
  const [dropPreview, setDropPreview] = useState<{ date: string; hour: number; isHalf: boolean } | null>(null);
  const lastClickTimeRef = useRef<number>(0);

  // Get positioned events for the week
  const weekDates = useMemo(
    () => weekColumns.map((col) => col.date),
    [weekColumns]
  );

  const positionedEventsMap = useMemo(
    () => getPositionedEventsWeek(weekDates),
    [getPositionedEventsWeek, weekDates]
  );

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
    const columnWidth = gridRect.width / 7;
    const columnIndex = Math.floor(clickX / columnWidth);

    if (columnIndex < 0 || columnIndex >= 7) return null;

    const scrollRect = scrollRef.current.getBoundingClientRect();
    const clickY = clientY - scrollRect.top + scrollRef.current.scrollTop - TIME_COLUMN_TOP_PADDING;
    
    if (clickY < 0) return null;

    const halfHourOffset = Math.floor(clickY / GRID.HALF_HOUR_HEIGHT);
    const hour = GRID.START_HOUR + Math.floor(halfHourOffset / 2);
    const isHalf = halfHourOffset % 2 === 1;

    if (hour < GRID.START_HOUR || hour >= GRID.END_HOUR) return null;

    return {
      date: weekColumns[columnIndex].dateString,
      dateObj: weekColumns[columnIndex].date,
      hour,
      isHalf,
      columnIndex
    };
  }, [weekColumns]);

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

    // We only update the start time, the backend/thunk should handle duration preservation
    // But updateEventThunk expects specific fields. We need to fetch the event to know duration?
    // Actually, updateEventThunk takes Partial<Event>. If we only send startTime, 
    // the backend *should* update endTime to maintain duration, OR we need to calculate it here.
    // 
    // Let's check `CalendarEvent` type.
    // For now, let's assume we need to calculate end time.
    // But we don't have the event object here easily (it's in the map).
    // Let's look up the event.
    
    let eventToUpdate = null;
    for (const events of positionedEventsMap.values()) {
      const found = events.find(e => e.id === draggedEventId);
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
      // Double-click: create event with 30-minute duration
      setModalDate(dateObj);
      setModalStartHour(hour + (isHalf ? 0.5 : 0));
      setModalEndHour(hour + (isHalf ? 1 : 0.5));
      setShowQuickEventModal(true);
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
          <DayHeadersRow days={weekColumns} />
        </div>

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
              <GridLines columnCount={7} hourCount={hourCount} topOffset={TIME_COLUMN_TOP_PADDING} />

              {/* Drop Preview */}
              {dropPreview && (
                <div
                  className="absolute bg-primary/30 border border-primary pointer-events-none z-30 transition-all duration-75 rounded"
                  style={{
                    left: `${((weekColumns.findIndex(col => col.dateString === dropPreview.date)) / 7) * 100}%`,
                    width: `${95 / 7}%`, // Slightly narrower than full column
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
                    left: `${((weekColumns.findIndex(col => col.dateString === selectedSlot.date)) / 7) * 100}%`,
                    width: `${100 / 7}%`,
                    top: `${TIME_COLUMN_TOP_PADDING + (selectedSlot.hour - GRID.START_HOUR) * GRID.HOUR_HEIGHT + (selectedSlot.isHalf ? GRID.HALF_HOUR_HEIGHT : 0)}px`,
                    height: `${GRID.HALF_HOUR_HEIGHT}px`,
                  }}
                />
              )}

              {/* Today highlight */}
              {weekColumns.map((day, index) => (
                day.isToday && (
                  <div
                    key={`today-${day.dateString}`}
                    className="absolute bg-primary/5 pointer-events-none"
                    style={{
                      left: `${(index / 7) * 100}%`,
                      width: `${100 / 7}%`,
                      top: TIME_COLUMN_TOP_PADDING,
                      bottom: 0,
                    }}
                  />
                )
              ))}

              {/* Events */}
              {weekColumns.map((day, columnIndex) => {
                const dayEvents = positionedEventsMap.get(day.dateString) || [];
                const columnWidth = 100 / 7;
                const columnLeft = columnIndex * columnWidth;

                return (
                  <div
                    key={day.dateString}
                    className="absolute pointer-events-none"
                    style={{
                      left: `${columnLeft}%`,
                      width: `${columnWidth}%`,
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

              {/* Current time indicator - spans all days */}
              <CurrentTimeIndicator
                days={weekColumns}
                topOffset={TIME_COLUMN_TOP_PADDING}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Quick event creation modal */}
      <QuickEventModal
        isOpen={showQuickEventModal}
        onClose={() => setShowQuickEventModal(false)}
        initialDate={modalDate}
        initialStartHour={modalStartHour}
        initialEndHour={modalEndHour}
      />
    </>
  );
}
