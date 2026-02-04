/**
 * QuickAccess - Quick filter buttons for Today, This Week, Upcoming, Bookmarked
 */

import { BookmarkSimple } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setQuickAccessFilter, goToToday } from '@/features/calendar/store';
import type { QuickAccessFilter } from '@/features/calendar/types';
import { cn } from '@/shared/utils/cn';
import { useBookmarksByType } from '@/features/bookmarks';

interface QuickAccessItem {
  id: QuickAccessFilter;
  label: string;
  useBookmarkIcon?: boolean;
}

const quickAccessItems: QuickAccessItem[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'bookmarked', label: 'Bookmarked', useBookmarkIcon: true },
];

export function QuickAccess() {
  const dispatch = useAppDispatch();
  const activeFilter = useAppSelector(
    (state) => state.calendarUi.quickAccessFilter
  );
  // Get bookmarked calendar events count
  const calendarBookmarks = useBookmarksByType('calendar_event');
  const bookmarkCount = calendarBookmarks.length;

  const handleClick = (filter: QuickAccessFilter) => {
    if (activeFilter === filter) {
      // Deselect if clicking the active filter
      dispatch(setQuickAccessFilter(null));
    } else {
      dispatch(setQuickAccessFilter(filter));
      if (filter === 'today') {
        dispatch(goToToday());
      }
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Quick Access
      </h3>
      <div className="space-y-1">
        {quickAccessItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleClick(item.id)}
            className={cn(
              'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors',
              activeFilter === item.id
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <div className="flex items-center gap-2">
              {item.useBookmarkIcon ? (
                <BookmarkSimple size={14} weight="duotone" />
              ) : (
                <span
                  className={cn(
                    'w-3 h-3 rounded-full border',
                    activeFilter === item.id
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  )}
                />
              )}
              <span>{item.label}</span>
            </div>
            {item.id === 'bookmarked' && bookmarkCount > 0 && (
              <span className="text-xs text-muted-foreground">{bookmarkCount}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
