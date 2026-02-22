import { useState, useRef, useEffect } from "react";
import { Plus, Circle, CheckCircle } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import {
  selectSubtasksByParentId,
  selectCurrentProject,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import { createTask, updateTask } from "@/features/projects/store/projectsThunks";
import type { Task } from "@/features/projects/types/project";

const STATUS_DONE = "status_done";
const STATUS_TODO = "status_todo";

interface SubtasksListProps {
  taskId: string;
  parentCompleted?: boolean;
}

export function SubtasksList({ taskId, parentCompleted }: SubtasksListProps) {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const subtasks = useAppSelector(selectSubtasksByParentId(taskId));
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const handleSubmit = () => {
    const title = newTitle.trim();
    if (title && project) {
      dispatch(
        createTask({
          projectId: project.id,
          title,
          parentId: taskId,
          status: STATUS_TODO,
        })
      );
    }
    setNewTitle("");
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setNewTitle("");
      setIsAdding(false);
    }
  };

  const handleToggle = (subtask: Task) => {
    const isDone = !!subtask.completedAt;
    const newStatus = isDone ? STATUS_TODO : STATUS_DONE;
    dispatch(
      optimisticUpdateTask({
        id: subtask.id,
        status: newStatus,
        completedAt: isDone ? null : new Date().toISOString(),
      })
    );
    dispatch(updateTask({ id: subtask.id, status: newStatus }));
  };

  const completedCount = parentCompleted
    ? subtasks.length
    : subtasks.filter((t) => t.completedAt).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Subtasks
        </h3>
        {subtasks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{subtasks.length}
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {subtasks.map((subtask) => (
          <SubtaskItem
            key={subtask.id}
            task={subtask}
            onToggle={handleToggle}
            parentCompleted={parentCompleted}
          />
        ))}

        {isAdding && (
          <div className="flex items-center gap-2 py-1 px-2">
            <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSubmit}
              placeholder="Subtask title..."
              className="flex-1 text-sm bg-transparent outline-none border-b border-primary text-foreground placeholder:text-muted-foreground pb-0.5"
            />
          </div>
        )}
      </div>

      {!isAdding && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground h-8 px-2 hover:bg-transparent hover:text-foreground"
          onClick={() => setIsAdding(true)}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add subtask
        </Button>
      )}
    </div>
  );
}

function SubtaskItem({
  task,
  onToggle,
  parentCompleted,
}: {
  task: Task;
  onToggle: (task: Task) => void;
  parentCompleted?: boolean;
}) {
  const isCompleted = parentCompleted || !!task.completedAt;

  return (
    <div className="group flex items-center gap-2 py-1 px-2 rounded-md hover:bg-muted/50">
      <button
        type="button"
        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
        onClick={() => onToggle(task)}
        disabled={parentCompleted}
      >
        {isCompleted ? (
          <CheckCircle className="h-4 w-4 text-primary" weight="fill" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>
      <span
        className={cn(
          "text-sm flex-1 truncate",
          isCompleted && "text-muted-foreground line-through"
        )}
      >
        {task.title}
      </span>
    </div>
  );
}
