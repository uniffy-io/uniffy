import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle,
  WarningCircle,
  ArrowsClockwise,
  Clock,
  CaretRight,
} from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { SubjectAvatarStack } from "@/components/subject";
import { MentionChipCompact } from "@/components/mention";
import { useMentionState } from "@/components/mention/useMentionState";
import type { Task, SelectOption } from "@/features/projects/types";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { TaskParentChip } from "@/features/projects/components/TaskParentChip";
import { BlockedBadge } from "@/features/projects/components/BlockedBadge";
import { useOpenBlockerCount } from "@/features/projects/hooks/useOpenBlockerCount";
import { extractFallbackLabel } from "@/shared/utils/mentionUtils";
import { TagChip } from "@/features/tags";

function ReferenceChip({ urn }: { urn: string }) {
  const liveState = useMentionState(urn);
  const label = liveState?.title || extractFallbackLabel(urn);
  return <MentionChipCompact urn={urn} label={label} liveState={liveState} />;
}

interface TaskCardProps {
  task: Task;
  priorityOption?: SelectOption;
  onClick: (e: React.MouseEvent) => void;
  projectSlug: string;
  reparentHintActive?: boolean;
}

export function TaskCard({
  task,
  priorityOption,
  onClick,
  projectSlug,
  reparentHintActive = false,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskOverdue = !task.completedAt && !!task.dueDate && isOverdue(task.dueDate);
  const isBlocked = useOpenBlockerCount(task) > 0;
  const hasTimeTracking = (task.estimatedMinutes ?? 0) > 0 || (task.timeSpentMinutes ?? 0) > 0;

  const ticketId = `${projectSlug}-${task.number}`;

  const visibleTags = useTagsByIds(task.tagIds ?? []);
  const shownTags = visibleTags.slice(0, 3);
  const overflowTagCount = Math.max(0, visibleTags.length - shownTags.length);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        // Dark mode: card and muted sit two points apart and read as one slab, so the card
        // drops to the surface gray and the column (BoardColumn) lifts to make the tray.
        "bg-card dark:bg-surface rounded-lg shadow-edge cursor-grab overflow-hidden transition-shadow duration-150",
        "hover:shadow-edge-primary",
        isDragging && "opacity-50 shadow-lg",
        reparentHintActive && "outline-2 outline-dashed outline-primary/70 -outline-offset-2",
        isBlocked && "border-l-2 border-l-yellow-500 dark:border-l-yellow-400",
      )}
      onClick={onClick}
    >
      <div className="p-3">
        {/* Ticket ID and type, with parent breadcrumb for subtasks */}
        <div className="flex items-center gap-1 mb-1.5 min-w-0">
          <TaskTypeIcon type={task.taskType} size={12} className="text-muted-foreground" />
          {task.parentId && (
            <>
              <TaskParentChip task={task} projectSlug={projectSlug} />
              <CaretRight size={9} className="text-subtle-foreground shrink-0" />
            </>
          )}
          <span
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(ticketId);
            }}
            title="Click to copy"
          >
            {ticketId}
          </span>
        </div>

        {/* Top Row: Title & Dates */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-tight pt-0.5">
                {task.title}
              </h3>
            </div>
          </div>

          {/* Dates - moved to top right */}
          {(task.startDate || task.dueDate) && (
            <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground shrink-0 leading-tight">
              {task.startDate && <span>Start: {formatDateShort(task.startDate)}</span>}
              {task.dueDate && (
                <span className={taskOverdue ? "text-destructive font-medium" : ""}>
                  Due: {formatDateShort(task.dueDate)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Middle Row: Priority & Indicators */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {/* Priority */}
          {priorityOption && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: `${priorityOption.color}15`,
                color: priorityOption.color,
              }}
            >
              {priorityOption.label}
            </span>
          )}

          <BlockedBadge task={task} />

          {/* Overdue Indicator */}
          {taskOverdue && (
            <span className="flex items-center px-1.5 py-0.5 rounded gap-1 text-[10px] bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
              <WarningCircle size={10} weight="fill" />
              Overdue
            </span>
          )}

          {/* Subtask Progress */}
          {task.subtaskTotal > 0 && (
            <span className="flex items-center text-muted-foreground bg-muted px-1.5 py-0.5 rounded gap-1 text-[10px]">
              <CheckCircle
                size={10}
                className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""}
              />
              {task.subtaskCompleted}/{task.subtaskTotal}
              <span className="text-muted-foreground/70">
                ({Math.round((task.subtaskCompleted / task.subtaskTotal) * 100)}%)
              </span>
            </span>
          )}

          {/* Time tracking */}
          {hasTimeTracking && (
            <span
              className={cn(
                "flex items-center px-1.5 py-0.5 rounded gap-1 text-[10px]",
                task.estimatedMinutes &&
                  task.timeSpentMinutes &&
                  task.timeSpentMinutes > task.estimatedMinutes
                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  : "text-muted-foreground bg-muted",
              )}
            >
              <Clock size={10} />
              {task.timeSpentMinutes ? formatMinutes(task.timeSpentMinutes) : "0m"}
              {task.estimatedMinutes ? ` / ${formatMinutes(task.estimatedMinutes)}` : ""}
            </span>
          )}

          {/* Recurrence indicator */}
          {task.recurrenceRule && (
            <span title="Recurring task">
              <ArrowsClockwise size={12} className="text-muted-foreground" />
            </span>
          )}
        </div>

        {/* Subtask Progress Bar */}
        {task.subtaskTotal > 0 && (
          <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                task.subtaskCompleted === task.subtaskTotal ? "bg-green-500" : "bg-primary",
              )}
              style={{
                width: `${(task.subtaskCompleted / task.subtaskTotal) * 100}%`,
              }}
            />
          </div>
        )}

        {/* Footer with assignees */}
        {(task.assigneeIds.length > 0 || task.outgoingReferences.length > 0) && (
          <div className="flex items-center justify-between pt-2 border-t border-border/50 mt-2">
            {/* Reference chips */}
            <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
              {task.outgoingReferences?.slice(0, 2).map((urn) => (
                <ReferenceChip key={urn} urn={urn} />
              ))}
              {(task.outgoingReferences?.length || 0) > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{(task.outgoingReferences?.length || 0) - 2}
                </span>
              )}
            </div>

            {/* Assignee avatars */}
            {task.assigneeIds.length > 0 && (
              <div className="ml-auto">
                <SubjectAvatarStack subjectIds={task.assigneeIds} maxDisplay={2} size="xs" />
              </div>
            )}
          </div>
        )}

        {/* Tags row - capped at 3 + overflow */}
        {shownTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-2">
            {shownTags.map((tag) => (
              <TagChip key={tag.id} tag={tag} nonInteractive className="px-1.5 py-0 text-[10px]" />
            ))}
            {overflowTagCount > 0 && (
              <span
                className="text-[10px] text-muted-foreground"
                title={visibleTags
                  .slice(3)
                  .map((t) => t.name)
                  .join(", ")}
              >
                +{overflowTagCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
