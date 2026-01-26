/**
 * LeftSidebar - Left sidebar container for the calendar
 *
 * Contains:
 * - New Event button
 * - Quick Access (Today, This Week, Upcoming, Bookmarked)
 * - Mini Calendar
 * - My Calendars
 * - Categories
 * - Tags
 */

import { Plus } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { openEventModal } from '../../store';
import { QuickAccess } from '../sidebar/QuickAccess';
import { MiniCalendar } from '../sidebar/MiniCalendar';
import { CalendarList } from '../sidebar/CalendarList';
import { CategoryList } from '../sidebar/CategoryList';
import { TagCloud } from '../sidebar/TagCloud';

export function LeftSidebar() {
  const dispatch = useAppDispatch();

  const handleNewEvent = () => {
    dispatch(openEventModal({ mode: 'create' }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* New Event Button */}
      <div className="px-5 pt-4 pb-4">
        <button
          type="button"
          onClick={handleNewEvent}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={16} weight="bold" />
          <span>New Event</span>
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-6">
        {/* Quick Access */}
        <QuickAccess />

        {/* Mini Calendar */}
        <MiniCalendar />

        {/* My Calendars */}
        <CalendarList />

        {/* Categories */}
        <CategoryList />

        {/* Tags */}
        <TagCloud />
      </div>
    </div>
  );
}
