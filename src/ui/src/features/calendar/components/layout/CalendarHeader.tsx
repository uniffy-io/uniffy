/**
 * CalendarHeader - Top navigation bar for the calendar
 *
 * Contains:
 * - Month/year display with navigation arrows
 * - Today button
 * - Timezone indicator
 * - View mode toggle (Day/Week/Month)
 */

import { CaretLeft, CaretRight, GlobeHemisphereWest, CaretDown } from '@phosphor-icons/react';
import { useCalendarNavigation } from '../../hooks';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { openTimezoneModal } from '../../store';
import { getTimezoneOffset } from '../../utils';
import { cn } from '@/utils/cn';
import type { ViewMode } from '../../types';

export function CalendarHeader() {
  const dispatch = useAppDispatch();
  const {
    headerTitle,
    viewMode,
    goToPrevious,
    goToNext,
    goToToday,
    changeViewMode,
  } = useCalendarNavigation();

  const displayTimezone = useAppSelector(
    (state) => state.calendarUi.displayTimezone
  );

  const timezoneOffset = getTimezoneOffset(displayTimezone);

  const viewModes: ViewMode[] = ['day', 'week', 'month'];

  return (
    <div className="flex items-center justify-between px-5 py-3 bg-card border-b border-border">
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        {/* Previous arrow */}
        <button
          onClick={goToPrevious}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          aria-label="Previous period"
        >
          <CaretLeft size={16} weight="bold" className="text-muted-foreground" />
        </button>

        {/* Month/Year title */}
        <h1 className="text-base font-medium text-foreground min-w-[140px]">
          {headerTitle}
        </h1>

        {/* Next arrow */}
        <button
          onClick={goToNext}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          aria-label="Next period"
        >
          <CaretRight size={16} weight="bold" className="text-muted-foreground" />
        </button>

        {/* Today button */}
        <button
          onClick={goToToday}
          className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          Today
        </button>
      </div>

      {/* Right: Timezone and View Toggle */}
      <div className="flex items-center gap-4">
        {/* Timezone indicator */}
        <button
          onClick={() => dispatch(openTimezoneModal())}
          className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <GlobeHemisphereWest size={16} weight="duotone" />
          <span>{timezoneOffset}</span>
          <CaretDown size={12} weight="bold" />
        </button>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5">
          {viewModes.map((mode) => (
            <button
              key={mode}
              onClick={() => changeViewMode(mode)}
              className={cn(
                'px-3 py-1 text-sm rounded-md transition-colors',
                viewMode === mode
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
