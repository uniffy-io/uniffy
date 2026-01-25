/**
 * QuickAccess - Quick filter buttons for Today, This Week, Upcoming, Favorites
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setQuickAccessFilter, goToToday } from '../../store';
import type { QuickAccessFilter } from '../../types';
import { cn } from '@/utils/cn';

interface QuickAccessItem {
  id: QuickAccessFilter;
  label: string;
  icon?: string;
}

const quickAccessItems: QuickAccessItem[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This Week' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'favorites', label: 'Favorites', icon: '★' },
];

export function QuickAccess() {
  const dispatch = useAppDispatch();
  const activeFilter = useAppSelector(
    (state) => state.calendarUi.quickAccessFilter
  );
  const favoriteCount = useAppSelector(
    (state) => state.calendar.favoriteEventIds.length
  );

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
              {item.id === 'favorites' ? (
                <span className="text-yellow-500 text-xs">{item.icon}</span>
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
            {item.id === 'favorites' && favoriteCount > 0 && (
              <span className="text-xs text-muted-foreground">{favoriteCount}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
