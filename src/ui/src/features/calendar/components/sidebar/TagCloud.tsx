/**
 * TagCloud - Display of tags used across events
 */

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { toggleTagFilter } from '../../store';
import { useCalendarEvents } from '../../hooks';
import { cn } from '@/utils/cn';

export function TagCloud() {
  const dispatch = useAppDispatch();
  const { allTags } = useCalendarEvents();
  const selectedTags = useAppSelector(
    (state) => state.calendar.filters.tags
  );

  const handleTagClick = (tag: string) => {
    dispatch(toggleTagFilter(tag));
  };

  if (allTags.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Tags
        </h3>
        <p className="text-xs text-muted-foreground">
          Tags you add to events will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Tags
      </h3>
      <div className="flex flex-wrap gap-2">
        {allTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);

          return (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className={cn(
                'px-2 py-1 text-xs rounded transition-colors',
                isSelected
                  ? 'bg-primary/30 text-primary'
                  : 'bg-primary/20 text-primary/80 hover:bg-primary/25'
              )}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
