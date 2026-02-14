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
import { useAppSelector } from "@/app/hooks";
import { selectSubtasksByParentId } from "../../../store/projectsSlice";
import type { Task, SelectOption } from "../../../types";

interface TaskCardProps {
  task: Task;
  statusOption?: SelectOption;
  priorityOption?: SelectOption;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: (taskId: string) => void;
  isSelected?: boolean;
}

export function TaskCard({
  task,
  statusOption,
  priorityOption,
  onClick,
  onCheckboxChange,
  isSelected,
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

  // Feature 7: Subtask progress
  const subtasks = useAppSelector(selectSubtasksByParentId(task.id));
  const completedSubtasks = subtasks.filter(t => t.completedAt).length;

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
        isSelected && "ring-2 ring-primary"
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
                  <span>Start: {formatDate(task.startDate)}</span>
              )}
              {task.dueDate && (
                  <span className={isOverdue(task.dueDate) ? "text-destructive font-medium" : ""}>
                    Due: {formatDate(task.dueDate)}
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
            {task.blockedByTaskIds && task.blockedByTaskIds.length > 0 && (
                <span className="flex items-center text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded gap-1 text-[10px]" title="Blocked">
                    <WarningCircle size={10} weight="fill" />
                    Blocked
                </span>
            )}
            
            {/* Subtasks Indicator */}
            {subtasks.length > 0 && (
                <span className="flex items-center text-muted-foreground bg-muted px-1.5 py-0.5 rounded gap-1 text-[10px]">
                    <CheckCircle size={10} />
                    {completedSubtasks}/{subtasks.length}
                </span>
            )}
        </div>

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
                {extractLabel(urn)}
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
            <div className="flex -space-x-1 ml-auto">
              {task.assigneeIds.slice(0, 2).map((id) => (
                <div
                  key={id}
                  className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[10px] text-primary-foreground border border-card"
                >
                  {id.slice(-2).toUpperCase()}
                </div>
              ))}
              {task.assigneeIds.length > 2 && (
                <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground border border-card">
                  +{task.assigneeIds.length - 2}
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function extractLabel(urn: string): string {
  const parts = urn.split(":");
  const type = parts[3]?.toLowerCase() || "item";
  const id = parts[4]?.slice(0, 6) || "";
  return `${type}:${id}`;
}
