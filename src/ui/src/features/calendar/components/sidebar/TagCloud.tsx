/** Multi-select tag filter is logical AND. */

import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { toggleTagFilter } from "@/features/calendar/store";
import { useCalendarEvents } from "@/features/calendar/hooks";
import { TagChip } from "@/features/tags";
import type { SerializedTag } from "@/features/tags";
import { cn } from "@/shared/utils/cn";

export function TagCloud() {
  const dispatch = useAppDispatch();
  const { allTagIds } = useCalendarEvents();
  const tagsById = useAppSelector((state) => state.tags.byId);
  const selectedTagIds = useAppSelector((state) => state.calendar.filters.tagIds);

  const tags: SerializedTag[] = allTagIds
    .map((id) => tagsById[id])
    .filter((tag): tag is SerializedTag => Boolean(tag))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (tags.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Tags
        </h3>
        <p className="text-xs text-muted-foreground">Tags you add to events will appear here</p>
      </div>
    );
  }

  const handleTagClick = (tagId: string) => {
    dispatch(toggleTagFilter(tagId));
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Tags
      </h3>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const isSelected = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => handleTagClick(tag.id)}
              aria-pressed={isSelected}
              className={cn(
                "focus-ring rounded-full transition-shadow",
                isSelected && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
              )}
            >
              <TagChip tag={tag} nonInteractive className="cursor-pointer" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
