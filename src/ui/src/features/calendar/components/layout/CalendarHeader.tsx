/**
 * CalendarHeader - Top navigation bar for the calendar
 *
 * Contains:
 * - Month/year display with navigation arrows
 * - Today button
 * - Timezone indicator
 * - View mode toggle (Day/Week/Month)
 */

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
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
      <div className="flex items-center gap-4">
        {/* Previous/Next arrows */}
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevious}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Previous period"
          >
            <ChevronLeftIcon className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Month/Year title */}
          <h1 className="text-xl font-semibold text-foreground min-w-[180px]">
            {headerTitle}
          </h1>

          <button
            onClick={goToNext}
            className="p-1 rounded-md hover:bg-muted transition-colors"
            aria-label="Next period"
          >
            <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Today button */}
        <button
          onClick={goToToday}
          className="px-3 py-1.5 text-sm font-medium text-muted-foreground bg-background border border-border rounded-md hover:bg-muted transition-colors"
        >
          Today
        </button>
      </div>

      {/* Right: Timezone and View Toggle */}
      <div className="flex items-center gap-4">
        {/* Timezone indicator */}
        <button
          onClick={() => dispatch(openTimezoneModal())}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="text-base">🌐</span>
          <span>{timezoneOffset}</span>
          <ChevronRightIcon className="w-3 h-3 rotate-90" />
        </button>

        {/* View mode toggle */}
        <div className="flex items-center bg-muted rounded-lg p-1">
          {viewModes.map((mode) => (
            <button
              key={mode}
              onClick={() => changeViewMode(mode)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                viewMode === mode
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
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
