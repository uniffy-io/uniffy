/**
 * LeftSidebar - Left sidebar container for the calendar
 *
 * Contains:
 * - New Event button
 * - Event Scope Filter (All, Personal, Organization) - compact icons with hover expand
 * - Quick Access (Today, This Week, Upcoming, Bookmarked)
 * - Mini Calendar
 * - Categories
 * - Tags
 */

import { Plus } from '@phosphor-icons/react';
import { useAppDispatch } from '@/app/hooks';
import { openEventModal } from '@/features/calendar/store';
import { EventScopeFilter } from '@/features/calendar/components/sidebar/EventScopeFilter';
import { QuickAccess } from '@/features/calendar/components/sidebar/QuickAccess';
import { MiniCalendar } from '@/features/calendar/components/sidebar/MiniCalendar';
import { CategoryList } from '@/features/calendar/components/sidebar/CategoryList';
import { TagCloud } from '@/features/calendar/components/sidebar/TagCloud';
import { TemplateList } from '@/features/calendar/components/sidebar/TemplateList';

export function LeftSidebar() {
  const dispatch = useAppDispatch();

  const handleNewEvent = () => {
    dispatch(openEventModal({ mode: 'create' }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with New Event Button */}
      <div className="px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={handleNewEvent}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={16} weight="bold" />
          <span>New Event</span>
        </button>
      </div>

      {/* Event Scope Filter - Compact icons with hover expand */}
      <EventScopeFilter />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-6 pt-4">
        {/* Quick Access */}
        <QuickAccess />

        {/* Mini Calendar */}
        <MiniCalendar />

        {/* Categories */}
        <CategoryList />

        {/* Templates */}
        <TemplateList />

        {/* Tags */}
        <TagCloud />
      </div>
    </div>
  );
}
