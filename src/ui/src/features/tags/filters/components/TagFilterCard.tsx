import { useState, useCallback, useMemo } from "react";
import { Funnel, Play, PencilSimple, Trash, Star, FunnelSimpleX } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { renderIcon } from "@/components/icon-picker";
import { useAppSelector } from "@/app/hooks";
import { TagChip } from "@/features/tags/components/TagChip";
import { cn } from "@/shared/utils/cn";
import {
  type SerializedSavedTagFilter,
  type SerializedTagFilterCriteria,
} from "@/features/tags/store/tagsThunks";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { UrnType } from "@/shared/utils/urnTypes";
import { getContentTypeConfig } from "@/config/theme/contentTypes";

interface TagFilterCardProps {
  filter: SerializedSavedTagFilter;
  onApply: (filter: SerializedSavedTagFilter) => void;
  onEdit?: (filter: SerializedSavedTagFilter) => void;
  onDelete?: (filterId: string) => void;
  isDeleting?: boolean;
}

const URN_TYPE_FROM_CONTENT_TYPE: Record<number, UrnType> = {
  [ContentType.NOTE]: UrnType.NOTE,
  [ContentType.FILE]: UrnType.FILE,
  [ContentType.CHAT]: UrnType.CHAT,
  [ContentType.CALENDAR_EVENT]: UrnType.CALENDAR_EVENT,
  [ContentType.PROJECT]: UrnType.PROJECT,
  [ContentType.TASK]: UrnType.TASK,
  [ContentType.AGENT]: UrnType.AGENT,
};

function summarize(criteria: SerializedTagFilterCriteria): string[] {
  const parts: string[] = [];
  if (criteria.untaggedOnly) parts.push("Untagged content");
  if (criteria.contentTypes.length) {
    const labels = criteria.contentTypes.map(
      (t) => getContentTypeConfig(URN_TYPE_FROM_CONTENT_TYPE[t] ?? UrnType.UNKNOWN).labelPlural,
    );
    parts.push(`Domains: ${labels.join(", ")}`);
  }
  if (criteria.ownerIds.length) parts.push(`${criteria.ownerIds.length} owner(s)`);
  if (criteria.sources.length) parts.push(`Source: ${criteria.sources.join(", ")}`);
  if (criteria.createdAfter || criteria.createdBefore) parts.push("Created date set");
  if (criteria.updatedAfter || criteria.updatedBefore) parts.push("Updated date set");
  if (criteria.accessMode !== null) parts.push("Access mode set");
  return parts;
}

export function TagFilterCard({
  filter,
  onApply,
  onEdit,
  onDelete,
  isDeleting = false,
}: TagFilterCardProps) {
  const tagsById = useAppSelector((s) => s.tags.byId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tagChips = useMemo(
    () =>
      (filter.criteria.tagIds ?? [])
        .map((id) => tagsById[id])
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [filter.criteria.tagIds, tagsById],
  );
  const summaryParts = useMemo(() => summarize(filter.criteria), [filter.criteria]);

  const renderFilterIcon = useCallback(() => {
    if (filter.icon) {
      if (filter.icon.type === "emoji") {
        return <span className="text-lg">{filter.icon.value}</span>;
      }
      return renderIcon(filter.icon, undefined, 20);
    }
    if (filter.criteria.untaggedOnly) {
      return <FunnelSimpleX size={20} weight="duotone" className="text-muted-foreground" />;
    }
    return <Funnel size={20} weight="duotone" className="text-muted-foreground" />;
  }, [filter.icon, filter.criteria.untaggedOnly]);

  return (
    <div
      className={cn(
        "group relative rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50",
        filter.isPreset && "border-primary/20",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            filter.isPreset ? "bg-primary/10" : "bg-muted",
          )}
        >
          {renderFilterIcon()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{filter.name}</h3>
            {filter.isPreset && <Star size={14} weight="fill" className="shrink-0 text-primary" />}
          </div>
          {filter.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {filter.description}
            </p>
          )}
        </div>
      </div>

      {summaryParts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summaryParts.slice(0, 3).map((part) => (
            <span
              key={part}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {part}
            </span>
          ))}
          {summaryParts.length > 3 && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              +{summaryParts.length - 3} more
            </span>
          )}
        </div>
      )}

      {tagChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tagChips.slice(0, 6).map((tag) => (
            <TagChip key={tag.id} tag={tag} nonInteractive />
          ))}
          {tagChips.length > 6 && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              +{tagChips.length - 6}
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button variant="default" size="sm" onClick={() => onApply(filter)} className="flex-1">
          <Play size={14} weight="fill" className="mr-1.5" />
          Apply
        </Button>
        {!filter.isPreset && onEdit && (
          <Button variant="outline" size="sm" onClick={() => onEdit(filter)} className="px-2">
            <PencilSimple size={14} weight="bold" />
          </Button>
        )}
        {!filter.isPreset && onDelete && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={isDeleting}
            className="px-2 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash size={14} weight="bold" />
          </Button>
        )}
      </div>

      {confirmDelete && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-background/95 p-4">
          <p className="mb-3 text-center text-sm">Delete &ldquo;{filter.name}&rdquo;?</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                onDelete?.(filter.id);
                setConfirmDelete(false);
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
