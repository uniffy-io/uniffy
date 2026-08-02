import { useMemo } from 'react';
import { Timer } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { TagChip, TagPicker } from '@/features/tags';
import { useTagsByIds } from '@/features/tags/store/selectors';
import { SectionLabel } from '@/features/calendar/components/detail/SectionLabel';
import type { CalendarEvent } from '@/features/calendar/types';
import type { EventPatch } from '@/features/calendar/hooks/useEventCommit';

interface EventMetaSectionProps {
  event: CalendarEvent;
  canEdit: boolean;
  commit: (patch: EventPatch) => void;
}

export function EventMetaSection({ event, canEdit, commit }: EventMetaSectionProps) {
  const categories = useAppSelector((state) => state.calendar.categories);
  const eventTags = useTagsByIds(event.tagIds);

  const categoryOptions = useMemo(
    () => Object.entries(categories).map(([id, cat]) => ({
      value: id,
      label: cat.name,
      color: cat.color,
    })),
    [categories]
  );

  if (!canEdit) {
    return eventTags.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {eventTags.map((tag) => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      </div>
    ) : null;
  }

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Category</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {categoryOptions.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => commit({ categoryId: cat.value })}
              className={cn(
                'px-2 py-1 text-xs rounded-lg border transition-all',
                event.categoryId === cat.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                style={{ backgroundColor: cat.color }}
              />
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Tags</SectionLabel>
        <TagPicker
          selectedTagIds={event.tagIds}
          onChange={(tagIds) => commit({ tagIds })}
          placeholder="Add tags..."
        />
      </div>

      <button
        type="button"
        onClick={() => commit({ isFocusTime: !event.isFocusTime })}
        className="flex items-center gap-2 px-2 py-1.5 bg-muted/30 rounded-lg w-full hover:bg-muted/50 transition-colors"
      >
        <Timer size={16} weight="duotone" className="text-muted-foreground" />
        <span
          className={cn(
            'w-3 h-3 rounded-full border-2 transition-colors',
            event.isFocusTime ? 'border-primary bg-primary' : 'border-muted-foreground'
          )}
        />
        <span className="text-xs text-foreground">Focus / Deep Work</span>
      </button>
    </div>
  );
}
