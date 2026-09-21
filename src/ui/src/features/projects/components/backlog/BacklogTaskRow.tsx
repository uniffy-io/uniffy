import { useState, useRef, useMemo } from "react";
import { ArrowRight, CalendarBlank, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { selectCurrentProject } from "@/features/projects/store/projectsSlice";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { TaskParentChip } from "@/features/projects/components/TaskParentChip";
import { BlockedBadge } from "@/features/projects/components/BlockedBadge";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, SelectOption } from "@/features/projects/types";
import { SubjectAvatarStack } from "@/components/subject";

interface BacklogTaskRowProps {
  task: Task;
  projectId: string;
  projectSlug: string;
  /** The sprint this task currently belongs to (null = backlog) */
  currentSprintId: string | null;
}

export function BacklogTaskRow({
  task,
  projectId,
  projectSlug,
  currentSprintId,
}: BacklogTaskRowProps) {
  const dispatch = useAppDispatch();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const project = useAppSelector(selectCurrentProject);

  const allSprints = useAppSelector(selectSprintsForProject(projectId));
  const availableSprints = allSprints.filter(
    (s) => s.status !== "closed" && s.id !== currentSprintId,
  );

  // Field definitions for status/priority labels and colors
  const statusOptions = useMemo(() => {
    const field = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
    return (field?.config.options ?? []) as SelectOption[];
  }, [project?.fieldDefinitions]);

  const priorityOptions = useMemo(() => {
    const field = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
    return (field?.config.options ?? []) as SelectOption[];
  }, [project?.fieldDefinitions]);

  const statusOption = useMemo(
    () => statusOptions.find((o) => o.id === task.status),
    [statusOptions, task.status],
  );

  const priorityOption = useMemo(
    () => priorityOptions.find((o) => o.id === task.priority),
    [priorityOptions, task.priority],
  );

  const handleMove = async (sprintId: string | null) => {
    setIsMenuOpen(false);
    await dispatch(updateTask({ id: task.id, sprintId }));
  };

  const renderMenu = () => {
    if (!isMenuOpen) return null;

    return (
      <ActionMenu
        open
        triggerRef={buttonRef}
        onClose={() => setIsMenuOpen(false)}
        label="Move task"
      >
        <div className="px-3 py-1 text-xs font-medium text-muted-foreground">Move to</div>
        {currentSprintId !== null && (
          <ActionMenuItem type="button" onClick={() => handleMove(null)}>
            Backlog
          </ActionMenuItem>
        )}
        {availableSprints.map((s) => (
          <ActionMenuItem key={s.id} type="button" onClick={() => handleMove(s.id)}>
            <span className="truncate">{s.name}</span>
          </ActionMenuItem>
        ))}
      </ActionMenu>
    );
  };

  const dueDateOverdue = !task.completedAt && !!task.dueDate && isOverdue(task.dueDate);

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
      {/* Task ID */}
      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">
        {projectSlug}-{task.number}
      </span>

      {/* Type + title */}
      <TaskParentChip task={task} projectSlug={projectSlug} className="text-xs max-w-[120px]" />
      <TaskTypeIcon type={task.taskType} className="text-muted-foreground" />
      <span className="text-sm text-foreground truncate flex-1 min-w-0">{task.title}</span>
      <BlockedBadge task={task} className="shrink-0" />

      {/* Due date */}
      {task.dueDate && (
        <span
          className={cn(
            "flex items-center gap-1 text-xs shrink-0",
            dueDateOverdue ? "text-red-500 dark:text-red-400" : "text-muted-foreground",
          )}
          title={`Due: ${task.dueDate}`}
        >
          <span className="text-muted-foreground">Due:</span>
          <CalendarBlank size={12} />
          {formatDateShort(task.dueDate)}
        </span>
      )}

      {/* Priority badge */}
      {priorityOption && (
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">Priority:</span>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{
              backgroundColor: `${priorityOption.color}15`,
              color: priorityOption.color,
            }}
          >
            {priorityOption.label}
          </span>
        </span>
      )}

      {/* Status badge */}
      {statusOption && (
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">Status:</span>
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{
              backgroundColor: statusPaint(statusOptions, statusOption.id).translucent,
              color: statusPaint(statusOptions, statusOption.id).solid,
            }}
          >
            {statusOption.label}
          </span>
        </span>
      )}

      {/* Subtask progress */}
      {task.subtaskTotal > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
          <CheckCircle
            size={10}
            className={task.subtaskCompleted === task.subtaskTotal ? "text-green-500" : ""}
          />
          {task.subtaskCompleted}/{task.subtaskTotal}
        </span>
      )}

      {/* Recurrence indicator */}
      {task.recurrenceRule && (
        <span className="shrink-0" title="Recurring task">
          <ArrowsClockwise size={12} className="text-muted-foreground" />
        </span>
      )}

      {/* Assignee avatars */}
      {task.assigneeIds.length > 0 && (
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">
            {task.assigneeIds.length > 1 ? "Assignees:" : "Assignee:"}
          </span>
          <SubjectAvatarStack subjectIds={task.assigneeIds} maxDisplay={2} size="xs" />
        </span>
      )}

      {/* Move-to menu */}
      {availableSprints.length > 0 || currentSprintId !== null ? (
        <>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={cn(
              "focus-ring grid h-11 w-11 lg:h-6 lg:w-6 place-items-center p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0",
              isMenuOpen
                ? "opacity-100"
                : "lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100",
            )}
            title="Move to..."
            aria-label="Move task"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
          >
            <ArrowRight size={14} />
          </button>
          {renderMenu()}
        </>
      ) : null}
    </div>
  );
}
