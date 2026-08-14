import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, CalendarBlank, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { selectCurrentProject } from "@/features/projects/store/projectsSlice";
import { getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const typeConfig = getTaskTypeConfig(task.taskType || "task");
  const TypeIcon = typeConfig.icon;

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.right - 176, // 176 = w-44 (11rem)
    });
  }, []);

  // Update position on open and scroll/resize
  useEffect(() => {
    if (!isMenuOpen) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [isMenuOpen, updatePosition]);

  // Close menu on outside click
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isMenuOpen]);

  // Close on escape
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  const handleMove = async (sprintId: string | null) => {
    setIsMenuOpen(false);
    await dispatch(updateTask({ id: task.id, sprintId }));
  };

  const renderMenu = () => {
    if (!isMenuOpen || !menuPos) return null;

    return createPortal(
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          top: menuPos.top,
          left: menuPos.left,
          width: 176,
        }}
        className="z-200 rounded-md border border-border bg-card shadow-xl py-1 animate-in fade-in-0 slide-in-from-top-2 duration-100"
      >
        <div className="px-3 py-1 text-xs font-medium text-muted-foreground">Move to</div>
        {currentSprintId !== null && (
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            onClick={() => handleMove(null)}
          >
            Backlog
          </button>
        )}
        {availableSprints.map((s) => (
          <button
            key={s.id}
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors truncate"
            onClick={() => handleMove(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>,
      document.body,
    );
  };

  const dueDateOverdue = task.dueDate ? isOverdue(task.dueDate) : false;

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors">
      {/* Type icon */}
      <TypeIcon size={14} weight="fill" className="text-muted-foreground shrink-0" />

      {/* Task ID */}
      <span className="text-xs font-mono text-muted-foreground w-20 shrink-0">
        {projectSlug}-{task.number}
      </span>

      {/* Title */}
      <span className="text-sm text-foreground truncate flex-1 min-w-0">{task.title}</span>

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
              backgroundColor: `${statusOption.color}15`,
              color: statusOption.color,
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
              "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0",
              isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            title="Move to..."
          >
            <ArrowRight size={14} />
          </button>
          {renderMenu()}
        </>
      ) : null}
    </div>
  );
}
