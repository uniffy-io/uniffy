import { useState } from "react";
import { CaretDown, CaretRight, PencilSimple, PushPin, Robot, Trash } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { MemorySource } from "@uniffy/proto/agents/v1/memories_pb";
import type { SerializedMemory } from "@/features/agents/store/agentMemoriesThunks";
import {
  CATEGORY_LABELS,
  getCategoryBadgeClass,
} from "@/features/agents/components/memory/memoryCategories";
import {
  MemoryEditForm,
  type MemoryFormValues,
} from "@/features/agents/components/memory/MemoryEditForm";

function formatTimestamp(ts?: { seconds: number; nanos: number }): string {
  if (!ts) return "";
  const date = new Date(ts.seconds * 1000);
  return formatRelativeTime(date.toISOString());
}

function ImportanceBar({ value }: { value: number }) {
  const segments = 10;
  const filled = Math.round(value * segments);

  return (
    <div className="flex items-center gap-0.5" title={`Importance: ${value.toFixed(1)}`}>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className={cn("w-1.5 h-3 rounded-sm", i < filled ? "bg-primary" : "bg-muted")}
        />
      ))}
    </div>
  );
}

export function MemoryRow({
  memory,
  canPin,
  canEdit,
  canDelete,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onTogglePin,
}: {
  memory: SerializedMemory;
  canPin: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (values: MemoryFormValues) => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-edge" data-testid="memory-row">
      <div className="px-4 py-3 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="p-1 -ml-1 mt-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
          title={expanded ? "Collapse" : "Expand"}
          data-state={expanded ? "open" : "closed"}
        >
          {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        </button>

        <Badge className={cn("shrink-0 mt-0.5", getCategoryBadgeClass(memory.category))}>
          {CATEGORY_LABELS[memory.category] ?? "Unknown"}
        </Badge>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{memory.key}</p>
          {!isEditing && memory.description && (
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{memory.description}</p>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            {canPin ? (
              <button
                type="button"
                onClick={onTogglePin}
                className={cn(
                  "p-1.5 rounded-md transition-colors cursor-pointer",
                  memory.pinned
                    ? "text-primary hover:bg-muted"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                title={memory.pinned ? "Unpin from context" : "Pin to context"}
              >
                <PushPin size={16} weight={memory.pinned ? "fill" : "regular"} />
              </button>
            ) : (
              memory.pinned && (
                <span className="p-1.5 text-primary" title="Always in context">
                  <PushPin size={16} weight="fill" />
                </span>
              )
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Edit memory"
              >
                <PencilSimple size={16} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={handleDelete}
                onBlur={() => setConfirmDelete(false)}
                className={cn(
                  "p-1.5 rounded-md transition-colors cursor-pointer",
                  confirmDelete
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground",
                )}
                title={confirmDelete ? "Click again to confirm" : "Delete memory"}
              >
                <Trash size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {isEditing && (
        <div className="px-4 pb-3">
          <MemoryEditForm memory={memory} onSave={onSave} onCancel={onCancelEdit} />
        </div>
      )}

      {expanded && !isEditing && (
        <>
          <div className="px-4 pb-3">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
              {memory.content}
            </p>
          </div>
          <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs font-medium text-muted-foreground flex-wrap">
            <Badge className="bg-muted text-muted-foreground border-transparent">
              {memory.source === MemorySource.MANUAL ? "Manual" : "Auto-saved"}
            </Badge>
            {memory.createdByAgentName && (
              <span className="flex items-center gap-1">
                <Robot size={12} />
                {memory.createdByAgentName}
              </span>
            )}
            {memory.createdByName && <span>saved by {memory.createdByName}</span>}
            <span>Read {memory.accessCount}x</span>
            <ImportanceBar value={memory.importance} />
            <span className="ml-auto">{formatTimestamp(memory.updatedAt)}</span>
          </div>
        </>
      )}
    </div>
  );
}
