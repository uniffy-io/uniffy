import { ArrowElbowDownRight } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { openDetailPanel, selectTask } from "@/features/projects/store/projectsUiSlice";
import type { Task } from "@/features/projects/types/project";

interface TaskParentChipProps {
  task: Task;
  /** Falls back to the task's own project. */
  projectSlug?: string;
  className?: string;
}

/** The parent's key on a subtask row or card; opens the parent without triggering the row. */
export function TaskParentChip({ task, projectSlug, className }: TaskParentChipProps) {
  const dispatch = useAppDispatch();
  const parent = useAppSelector((state) =>
    task.parentId ? state.projects.tasks[task.parentId] : undefined,
  );
  const slug = useAppSelector(
    (state) => projectSlug ?? state.projects.projects[task.projectId]?.slug ?? "",
  );

  const parentId = task.parentId;
  if (!parentId) return null;

  return (
    <button
      type="button"
      // Stops dnd-kit from reading the press as the start of a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        dispatch(selectTask(parentId));
        dispatch(openDetailPanel());
      }}
      className={cn(
        "flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/70 hover:text-foreground transition-colors truncate max-w-[100px] shrink-0",
        className,
      )}
      title={parent ? `Subtask of ${parent.title}` : "Subtask"}
    >
      <ArrowElbowDownRight size={10} weight="bold" className="shrink-0" />
      <span className="truncate">{parent ? `${slug}-${parent.number}` : "Subtask"}</span>
    </button>
  );
}
