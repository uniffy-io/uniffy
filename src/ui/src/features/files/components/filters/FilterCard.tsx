import { useState, useCallback, useMemo } from "react";
import {
  Funnel,
  Play,
  PencilSimple,
  Trash,
  Star,
  Image,
  FileDoc,
  Video,
  FileArchive,
  HardDrive,
  Calendar,
  Tag,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { renderIcon } from "@/components/icon-picker";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import { TagChip } from "@/features/tags";
import type {
  SerializedSavedFilter,
  SerializedFilterCriteria,
} from "@/features/files/store/savedFiltersSlice";
import { formatFileSize } from "@/shared/utils/dateFormatting";

interface FilterCardProps {
  filter: SerializedSavedFilter;
  onApply: (filter: SerializedSavedFilter) => void;
  onEdit?: (filter: SerializedSavedFilter) => void;
  onDelete?: (filterId: string) => void;
  isDeleting?: boolean;
}

/** Tag criteria render through `<TagChip>` from the tags-slice cache; this returns only the non-tag chips. */
function getCriteriaSummary(criteria: SerializedFilterCriteria): string[] {
  const parts: string[] = [];

  if (criteria.extensions?.length) {
    parts.push(`Extensions: ${criteria.extensions.join(", ")}`);
  }

  if (criteria.mimeCategories?.length) {
    parts.push(`Types: ${criteria.mimeCategories.join(", ")}`);
  }

  if (criteria.sizeMinBytes || criteria.sizeMaxBytes) {
    if (criteria.sizeMinBytes && criteria.sizeMaxBytes) {
      parts.push(
        `Size: ${formatFileSize(criteria.sizeMinBytes)} - ${formatFileSize(criteria.sizeMaxBytes)}`,
      );
    } else if (criteria.sizeMinBytes) {
      parts.push(`Size: > ${formatFileSize(criteria.sizeMinBytes)}`);
    } else if (criteria.sizeMaxBytes) {
      parts.push(`Size: < ${formatFileSize(criteria.sizeMaxBytes)}`);
    }
  }

  return parts;
}

type FilterIconType =
  | "image"
  | "document"
  | "video"
  | "archive"
  | "size"
  | "date"
  | "tag"
  | "default";

function getFilterIconType(criteria: SerializedFilterCriteria): FilterIconType {
  if (criteria.mimeCategories?.includes("image")) {
    return "image";
  }
  if (criteria.mimeCategories?.includes("document")) {
    return "document";
  }
  if (criteria.mimeCategories?.includes("video")) {
    return "video";
  }
  if (criteria.mimeCategories?.includes("archive")) {
    return "archive";
  }
  if (criteria.sizeMinBytes || criteria.sizeMaxBytes) {
    return "size";
  }
  if (criteria.createdAfter || criteria.createdBefore) {
    return "date";
  }
  if (criteria.tagIds?.length) {
    return "tag";
  }
  return "default";
}

const ICON_MAP: Record<FilterIconType, Icon> = {
  image: Image,
  document: FileDoc,
  video: Video,
  archive: FileArchive,
  size: HardDrive,
  date: Calendar,
  tag: Tag,
  default: Funnel,
};

export function FilterCard({
  filter,
  onApply,
  onEdit,
  onDelete,
  isDeleting = false,
}: FilterCardProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    onDelete?.(filter.id);
    setShowDeleteConfirm(false);
  }, [filter.id, onDelete]);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
  }, []);

  const iconType = useMemo(() => getFilterIconType(filter.criteria), [filter.criteria]);
  const FilterIcon = ICON_MAP[iconType];
  const summaryParts = getCriteriaSummary(filter.criteria);

  const tagsById = useAppSelector((state) => state.tags.byId);
  const tagChips = useMemo(() => {
    const ids = filter.criteria.tagIds ?? [];
    return ids
      .map((id) => tagsById[id])
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  }, [filter.criteria.tagIds, tagsById]);

  const renderFilterIcon = () => {
    if (filter.icon) {
      if (filter.icon.type === "emoji") {
        return <span className="text-lg">{filter.icon.value}</span>;
      }
      return renderIcon(filter.icon, undefined, 20);
    }
    return (
      <FilterIcon
        size={20}
        weight="duotone"
        className={filter.isPreset ? "text-primary" : "text-muted-foreground"}
      />
    );
  };

  return (
    <div
      className={cn(
        "group relative bg-card border border-border rounded-lg p-4 hover:border-primary/50 transition-colors",
        filter.isPreset && "border-primary/20",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
            filter.isPreset ? "bg-primary/10" : "bg-muted",
          )}
        >
          {renderFilterIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm truncate">{filter.name}</h3>
            {filter.isPreset && (
              <Star size={14} weight="fill" className="text-primary flex-shrink-0" />
            )}
          </div>

          {filter.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {filter.description}
            </p>
          )}
        </div>
      </div>

      {/* Criteria Summary */}
      {summaryParts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {summaryParts.slice(0, 3).map((part, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2 py-0.5 text-xs bg-muted rounded-md text-muted-foreground"
            >
              {part}
            </span>
          ))}
          {summaryParts.length > 3 && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs bg-muted rounded-md text-muted-foreground">
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
            <span className="inline-flex items-center px-2 py-0.5 text-xs bg-muted rounded-md text-muted-foreground">
              +{tagChips.length - 6}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
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
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-2 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50"
          >
            <Trash size={14} weight="bold" />
          </Button>
        )}
      </div>

      {/* Delete Confirmation Overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/95 rounded-lg flex flex-col items-center justify-center p-4 animate-in fade-in duration-150">
          <p className="text-sm text-center mb-3">Delete &quot;{filter.name}&quot;?</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCancelDelete}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
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
