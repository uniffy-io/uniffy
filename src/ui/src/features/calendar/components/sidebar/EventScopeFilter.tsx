/**
 * EventScopeFilter - Compact nav items for filtering events by scope
 * Matches the Files sidebar pattern with hover-to-expand animation
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setEventScope } from '@/features/calendar/store/calendarUiSlice';
import { cn } from '@/shared/utils/cn';
import { SCOPE_FILTERS } from '@/features/calendar/components/sidebar/eventScopeConstants';
import type { ScopeFilterConfig, EventScope } from '@/features/calendar/components/sidebar/eventScopeConstants';

/**
 * Compact nav item that expands on hover to show label.
 */
export function CompactScopeItem({
  filter,
  isActive,
  onClick,
}: {
  filter: ScopeFilterConfig;
  isActive: boolean;
  onClick: () => void;
}) {
  const IconComponent = filter.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex items-center py-1.5 px-1.5 text-sm font-medium rounded-lg transition-all duration-700 ease-out overflow-hidden',
        'hover:px-2.5',
        isActive && 'text-foreground'
      )}
    >
      {/* Active indicator */}
      <span
        className={cn(
          'absolute inset-0 rounded-lg transition-all duration-500',
          isActive ? 'bg-primary/10' : 'bg-transparent'
        )}
      />

      {/* Hover underline effect */}
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-700 ease-out w-0 opacity-0 group-hover:w-1/2 group-hover:opacity-70" />

      {/* Icon */}
      <span
        className={cn(
          'relative z-10 flex items-center justify-center w-7 h-7 rounded-md transition-all duration-500 ease-out',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground group-hover:text-primary'
        )}
      >
        <IconComponent size={18} weight={isActive ? 'fill' : 'duotone'} />
      </span>

      {/* Label - hidden by default, shows on hover */}
      <span
        className={cn(
          'relative z-10 ml-0 max-w-0 overflow-hidden whitespace-nowrap transition-all duration-700 ease-out',
          'group-hover:ml-1.5 group-hover:max-w-24',
          isActive
            ? 'text-foreground'
            : 'text-muted-foreground group-hover:text-foreground'
        )}
      >
        {filter.name}
      </span>
    </button>
  );
}

export function EventScopeFilter() {
  const dispatch = useAppDispatch();
  const eventScope = useAppSelector((state) => state.calendarUi.eventScope);

  const handleScopeChange = (scope: EventScope) => {
    dispatch(setEventScope(scope));
  };

  return (
    <div className="px-3 py-2 border-b border-border">
      <nav className="flex items-center gap-0.5">
        {SCOPE_FILTERS.map((filter) => (
          <CompactScopeItem
            key={filter.id}
            filter={filter}
            isActive={eventScope === filter.id}
            onClick={() => handleScopeChange(filter.id)}
          />
        ))}
      </nav>
    </div>
  );
}
