/**
 * TaskCard - Draggable card for the Board view
 *
 * Features:
 * - Top color bar matching status
 * - Task title with number
 * - Priority badge
 * - Due date (red if overdue)
 * - Assignee avatars
 * - Reference chips
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { SubjectAvatarStack } from "@/components/subject";
import type { Task, SelectOption } from "@/features/projects/types";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import { extractFallbackLabel } from "@/shared/utils/mentionUtils";

interface TaskCardProps {
  task: Task;
  statusOption?: SelectOption;
  priorityOption?: SelectOption;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  isSelected?: boolean;
  projectSlug: string;
}

export function TaskCard({
  task,
  statusOption,
  priorityOption,
  onClick,
  onCheckboxChange,
  isSelected,
  projectSlug,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const taskOverdue = task.dueDate && task.status !== "status_done" && isOverdue(task.dueDate);
  const hasUnresolvedBlockers = task.blockedByTaskIds && task.blockedByTaskIds.length > 0 && task.status !== "status_done";

  const ticketId = `${projectSlug}-${task.number}`;
  const typeConfig = getTaskTypeConfig(task.taskType || "task");
  const TypeIcon = typeConfig.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-card rounded-lg border border-border shadow-sm cursor-grab overflow-hidden",
        "hover:border-primary/50 transition-colors",
        isDragging && "opacity-50 shadow-lg",
        isSelected && "ring-2 ring-primary",
        hasUnresolvedBlockers && "border-l-2 border-l-yellow-500 dark:border-l-yellow-400"
      )}
      onClick={onClick}
    >
      {/* Status color bar at top */}
      {statusOption && (
        <div
          className="h-1"
          style={{ backgroundColor: statusOption.color }}
        />
      )}

      <div className="p-3">
        {/* Ticket ID and type */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <TypeIcon size={12} className="text-muted-foreground shrink-0" weight="fill" />
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
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border mt-0.5 shrink-0"
              checked={!!isSelected}
              onChange={(e) => {
                e.stopPropagation();
                onCheckboxChange(task.id);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-tight pt-0.5">
                {task.title}
              </h3>
            </div>
          </div>
          
          {/* Dates - moved to top right */}
          {(task.startDate || task.dueDate) && (
            <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground shrink-0 leading-tight">
              {task.startDate && (
                  <span>Start: {formatDateShort(task.startDate)}</span>
              )}
              {task.dueDate && (
                  <span className={isOverdue(task.dueDate) ? "text-destructive font-medium" : ""}>
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

            {/* Blocked Indicator */}
            {hasUnresolvedBlockers && (
                <span
                  className="flex items-center px-1.5 py-0.5 rounded gap-1 text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                  title={`Blocked by ${task.blockedByTaskIds.length} task(s)`}
                >
                    <WarningCircle size={10} weight="fill" />
                    Blocked ({task.blockedByTaskIds.length})
                </span>
            )}

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
                    <CheckCircle size={10} className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""} />
                    {task.subtaskCompleted}/{task.subtaskTotal}
                </span>
            )}
        </div>

        {/* Subtask Progress Bar */}
        {task.subtaskTotal > 0 && (
          <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                task.subtaskCompleted === task.subtaskTotal ? "bg-green-500" : "bg-primary"
              )}
              style={{ width: `${(task.subtaskCompleted / task.subtaskTotal) * 100}%` }}
            />
          </div>
        )}

        {/* Footer with assignees */}
        {(task.assigneeIds.length > 0 || task.outgoingReferences.length > 0) && (
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          {/* Reference chips */}
          <div className="flex flex-wrap gap-1">
            {task.outgoingReferences?.slice(0, 2).map((urn) => (
              <span
                key={urn}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground"
              >
                {extractFallbackLabel(urn)}
              </span>
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
      </div>
    </div>
  );
}
