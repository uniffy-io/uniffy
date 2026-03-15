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

import { Plus, CalendarBlank, CaretDoubleLeft } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { openEventModal, toggleSidebar } from '@/features/calendar/store';
import { setEventScope } from '@/features/calendar/store/calendarUiSlice';
import { QuickAccess } from '@/features/calendar/components/sidebar/QuickAccess';
import { MiniCalendar } from '@/features/calendar/components/sidebar/MiniCalendar';
import { CategoryList } from '@/features/calendar/components/sidebar/CategoryList';
import { TagCloud } from '@/features/calendar/components/sidebar/TagCloud';
import { TemplateList } from '@/features/calendar/components/sidebar/TemplateList';
import { CompactScopeItem } from '@/features/calendar/components/sidebar/EventScopeFilter';
import { SCOPE_FILTERS } from '@/features/calendar/components/sidebar/eventScopeConstants';

export function LeftSidebar() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const eventScope = useAppSelector((state) => state.calendarUi.eventScope);

  const handleNewEvent = () => {
    dispatch(openEventModal({ mode: 'create' }));
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        <button
          type="button"
          onClick={handleNewEvent}
          className="group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden hover:px-2.5"
          title="New Event"
        >
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />
          <span className="relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out text-muted-foreground group-hover:text-primary">
            <CalendarBlank size={18} weight="duotone" />
            <Plus size={10} weight="bold" className="absolute -top-0.5 -right-0.5" />
          </span>
          <span className="relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out group-hover:ml-1.5 group-hover:max-w-24 text-muted-foreground group-hover:text-foreground">
            Event
          </span>
        </button>
        {SCOPE_FILTERS.map((filter) => (
          <CompactScopeItem
            key={filter.id}
            filter={filter}
            isActive={eventScope === filter.id}
            onClick={() => dispatch(setEventScope(filter.id))}
          />
        ))}
        <div className="flex-1" />
        {!isMobile && (
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title="Toggle sidebar"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 pb-4 space-y-4 md:space-y-6 pt-3 md:pt-4">
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
