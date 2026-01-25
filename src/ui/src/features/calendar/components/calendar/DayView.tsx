/**
 * DayView - Single day calendar view
 */

import { useRef, useEffect, useMemo, useState } from 'react';
import { useCalendarNavigation, useCalendarEvents } from '../../hooks';
import { TimeColumn, TIME_COLUMN_TOP_PADDING } from './TimeColumn';
import { DayHeader } from './DayHeader';
import { GridLines } from './GridLines';
import { DayCurrentTimeIndicator } from './CurrentTimeIndicator';
import { EventBlock } from './EventBlock';
import { QuickEventModal } from '../modals/QuickEventModal';
import { GRID, LAYOUT } from '../../constants';
import { parseISO, format } from '../../utils';

export function DayView() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { currentDate } = useCalendarNavigation();
  const { getPositionedEvents } = useCalendarEvents();
  const [showQuickEventModal, setShowQuickEventModal] = useState(false);
  const [modalStartHour, setModalStartHour] = useState(9);
  const [modalEndHour, setModalEndHour] = useState(10);
  
  // State for half-hour slot selection
  const [selectedSlot, setSelectedSlot] = useState<{ hour: number; isHalf: boolean } | null>(null);
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

    if (!gridRef.current || !scrollRef.current) return;

    // Calculate which half-hour slot was clicked (accounting for top padding)
    const scrollRect = scrollRef.current.getBoundingClientRect();
    const clickY = e.clientY - scrollRect.top + scrollRef.current.scrollTop - TIME_COLUMN_TOP_PADDING;
    if (clickY < 0) return; // Clicked in the padding area above the grid
    const halfHourSlotHeight = hourHeight / 2;
    const halfHourOffset = Math.floor(clickY / halfHourSlotHeight);
    const clickedHour = GRID.START_HOUR + Math.floor(halfHourOffset / 2);
    const isHalf = halfHourOffset % 2 === 1;

    // Ensure hour is within bounds
    if (clickedHour < GRID.START_HOUR || clickedHour >= GRID.END_HOUR) return;

    const currentTime = Date.now();
    const isDoubleClick = currentTime - lastClickTimeRef.current < 300 && 
                          selectedSlot?.hour === clickedHour && 
                          selectedSlot?.isHalf === isHalf;

    if (isDoubleClick) {
      // Double-click: create event with 30-minute duration
      setModalStartHour(clickedHour + (isHalf ? 0.5 : 0));
      setModalEndHour(clickedHour + (isHalf ? 1 : 0.5));
      setShowQuickEventModal(true);
      setSelectedSlot(null);
    } else {
      // Single click: select slot
      setSelectedSlot({ hour: clickedHour, isHalf });
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

      {/* Quick event creation modal */}
      <QuickEventModal
        isOpen={showQuickEventModal}
        onClose={() => setShowQuickEventModal(false)}
        initialDate={currentDateObj}
        initialStartHour={modalStartHour}
        initialEndHour={modalEndHour}
      />
    </>
  );
}
