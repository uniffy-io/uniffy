/**
 * LeftSidebar - Left sidebar container for the calendar
 *
 * Contains:
 * - New Event button
 * - Quick Access (Today, This Week, Upcoming, Favorites)
 * - Mini Calendar
 * - My Calendars
 * - Categories
 * - Tags
 */

import { PlusIcon } from '@heroicons/react/24/outline';
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
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary to-primary/90 text-primary-foreground rounded-lg font-semibold text-sm hover:from-primary/90 hover:to-primary/80 transition-all shadow-sm cursor-pointer"
        >
          <PlusIcon className="w-5 h-5" />
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
