import { useCallback } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import { Virtuoso } from "react-virtuoso";

import { cn } from "@/shared/utils/cn";
import { TagChip } from "@/features/tags/components/TagChip";
import type { SerializedTag } from "@/features/tags/store/tagsThunks";

interface TagListProps {
  tags: readonly SerializedTag[];
  selectedTagId: string | null;
  onSelect: (tag: SerializedTag) => void;
  onEdit?: (tag: SerializedTag) => void;
  onDelete?: (tag: SerializedTag) => void;
  nextPageToken?: string;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

export function TagList({
  tags,
  selectedTagId,
  onSelect,
  onEdit,
  onDelete,
  nextPageToken,
  onLoadMore,
  isLoadingMore,
}: TagListProps) {
  const itemContent = useCallback(
    (_index: number, tag: SerializedTag) => {
      const isSelected = tag.id === selectedTagId;
      return (
        <li
          key={tag.id}
          className={cn(
            "group flex items-center gap-3 px-3 py-2 transition-colors border-b border-border/40",
            isSelected ? "bg-primary/5" : "hover:bg-muted/40",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(tag)}
            className="flex flex-1 items-center gap-3 text-left"
          >
            <TagChip tag={tag} nonInteractive />
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {tag.description || tag.name}
            </span>
            <span className="text-xs text-muted-foreground/80 tabular-nums">{tag.usageCount}</span>
          </button>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(tag)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Edit tag"
              >
                <PencilSimple size={14} weight="bold" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(tag)}
                className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete tag"
              >
                <Trash size={14} weight="bold" />
              </button>
            )}
          </div>
        </li>
      );
    },
    [onSelect, onEdit, onDelete, selectedTagId],
  );

  const endReached = useCallback(() => {
    if (nextPageToken && onLoadMore && !isLoadingMore) {
      onLoadMore();
    }
  }, [nextPageToken, onLoadMore, isLoadingMore]);

  if (tags.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No tags match the current filter.
      </div>
    );
  }

  return (
    <Virtuoso
      className="h-full"
      data={tags as SerializedTag[]}
      computeItemKey={(_index, tag) => tag.id}
      itemContent={itemContent}
      endReached={endReached}
      increaseViewportBy={400}
      components={{
        Footer: () =>
          isLoadingMore ? (
            <div className="px-3 py-2 text-center text-xs text-muted-foreground">Loading...</div>
          ) : null,
      }}
    />
  );
}
