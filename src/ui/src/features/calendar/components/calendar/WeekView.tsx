/**
 * WeekView - Week calendar grid view
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useCalendarNavigation, useCalendarEvents } from '../../hooks';
import { TimeColumn, TIME_COLUMN_TOP_PADDING } from './TimeColumn';
import { DayHeadersRow } from './DayHeader';
import { GridLines } from './GridLines';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { EventBlock } from './EventBlock';
import { QuickEventModal } from '../modals/QuickEventModal';
import { GRID, LAYOUT } from '../../constants';

export function WeekView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { weekColumns } = useCalendarNavigation();
  const { getPositionedEventsWeek } = useCalendarEvents();
  const [showQuickEventModal, setShowQuickEventModal] = useState(false);
  const [modalDate, setModalDate] = useState(new Date());
  const [modalStartHour, setModalStartHour] = useState(9);
  const [modalEndHour, setModalEndHour] = useState(10);
  
  // State for half-hour slot selection
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; hour: number; isHalf: boolean } | null>(null);
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

    if (!gridRef.current || !scrollRef.current) return;

    // Calculate which column was clicked (day)
    const gridRect = gridRef.current.getBoundingClientRect();
    const clickX = e.clientX - gridRect.left;
    const columnWidth = gridRect.width / 7;
    const columnIndex = Math.floor(clickX / columnWidth);

    if (columnIndex < 0 || columnIndex >= 7) return;

    // Calculate which half-hour slot was clicked (accounting for top padding)
    const scrollRect = scrollRef.current.getBoundingClientRect();
    const clickY = e.clientY - scrollRect.top + scrollRef.current.scrollTop - TIME_COLUMN_TOP_PADDING;
    if (clickY < 0) return; // Clicked in the padding area above the grid
    const halfHourOffset = Math.floor(clickY / GRID.HALF_HOUR_HEIGHT);
    const clickedHour = GRID.START_HOUR + Math.floor(halfHourOffset / 2);
    const isHalf = halfHourOffset % 2 === 1;

    // Ensure hour is within bounds
    if (clickedHour < GRID.START_HOUR || clickedHour >= GRID.END_HOUR) return;

    const clickedDate = weekColumns[columnIndex].dateString;
    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTimeRef.current < 300 && 
                          selectedSlot?.date === clickedDate && 
                          selectedSlot?.hour === clickedHour && 
                          selectedSlot?.isHalf === isHalf;

    if (isDoubleClick) {
      // Double-click: create event with 30-minute duration
      setModalDate(weekColumns[columnIndex].date);
      setModalStartHour(clickedHour + (isHalf ? 0.5 : 0));
      setModalEndHour(clickedHour + (isHalf ? 1 : 0.5));
      setShowQuickEventModal(true);
      setSelectedSlot(null);
    } else {
      // Single click: select slot
      setSelectedSlot({ date: clickedDate, hour: clickedHour, isHalf });
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
            >
              {/* Grid lines */}
              <GridLines columnCount={7} hourCount={hourCount} topOffset={TIME_COLUMN_TOP_PADDING} />

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
