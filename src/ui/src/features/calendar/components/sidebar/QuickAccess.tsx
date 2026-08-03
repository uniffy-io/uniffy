import { BookmarkSimple } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setQuickAccessFilter, goToToday, setViewMode } from '@/features/calendar/store';
import type { QuickAccessFilter, ViewMode } from '@/features/calendar/types';
import { cn } from '@/shared/utils/cn';
import { useBookmarksByType } from '@/features/bookmarks';

interface QuickAccessItem {
  id: QuickAccessFilter;
  label: string;
  useBookmarkIcon?: boolean;
  /** View the filtered set is legible in. Bookmarked has no natural home, so it filters the current view instead. */
  view?: ViewMode;
  jumpToToday?: boolean;
}

const quickAccessItems: QuickAccessItem[] = [
  { id: 'today', label: 'Today', view: 'day', jumpToToday: true },
  { id: 'this_week', label: 'This Week', view: 'week', jumpToToday: true },
  { id: 'upcoming', label: 'Upcoming', view: 'agenda' },
  { id: 'bookmarked', label: 'Bookmarked', useBookmarkIcon: true },
];

export function QuickAccess() {
  const dispatch = useAppDispatch();
  const activeFilter = useAppSelector(
    (state) => state.calendarUi.quickAccessFilter
  );
  const calendarBookmarks = useBookmarksByType('calendar_event');
  const bookmarkCount = calendarBookmarks.length;

  const handleClick = (item: QuickAccessItem) => {
    if (activeFilter === item.id) {
      dispatch(setQuickAccessFilter(null));
      return;
    }

    dispatch(setQuickAccessFilter(item.id));
    if (item.jumpToToday) {
      dispatch(goToToday());
    }
    if (item.view) {
      dispatch(setViewMode(item.view));
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
            onClick={() => handleClick(item)}
            className={cn(
              'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors',
              activeFilter === item.id
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <div className="flex items-center gap-2">
              {item.useBookmarkIcon ? (
                <BookmarkSimple
                  size={14}
                  weight={activeFilter === item.id ? 'fill' : 'duotone'}
                  className={activeFilter === item.id ? 'text-primary' : ''}
                />
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
