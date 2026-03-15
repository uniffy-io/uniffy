/**
 * MainContent - Main calendar content area
 *
 * Contains:
 * - Calendar header with navigation
 * - Calendar grid (week/day/month view)
 *
 * On mobile, WeekView automatically shows a 3-day view instead of 7.
 */

import { CalendarHeader } from '@/features/calendar/components/layout/CalendarHeader';
import { useAppSelector } from '@/app/hooks';
import { WeekView } from '@/features/calendar/components/calendar/WeekView';
import { DayView } from '@/features/calendar/components/calendar/DayView';
import { MonthView } from '@/features/calendar/components/calendar/MonthView';

export function MainContent() {
  const viewMode = useAppSelector((state) => state.calendarUi.viewMode);

  return (
    <div className="h-full flex flex-col">
      {/* Calendar Header */}
      <CalendarHeader />

      {/* Calendar Grid */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'day' && <DayView />}
        {viewMode === 'week' && <WeekView />}
        {viewMode === 'month' && <MonthView />}
      </div>
    </div>
  );
}
