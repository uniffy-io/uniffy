/**
 * MainContent - Main calendar content area
 *
 * Contains:
 * - Calendar header with navigation
 * - Day headers
 * - Calendar grid (week/day/month view)
 */

import { CalendarHeader } from './CalendarHeader';
import { useAppSelector } from '@/app/hooks';
import { WeekView } from '../calendar/WeekView';
import { DayView } from '../calendar/DayView';
import { MonthView } from '../calendar/MonthView';

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
