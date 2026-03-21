import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, Circle, CheckCircle, CaretRight, CaretDown } from "@phosphor-icons/react";
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
const MAX_DEPTH = 5;

interface SubtasksListProps {
  taskId: string;
  parentCompleted?: boolean;
}

export function SubtasksList({ taskId, parentCompleted }: SubtasksListProps) {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const subtasks = useAppSelector(selectSubtasksByParentId(taskId));
  const [addingForParentId, setAddingForParentId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingForParentId) {
      inputRef.current?.focus();
    }
  }, [addingForParentId]);

  const handleSubmit = useCallback(() => {
    const title = newTitle.trim();
    if (title && project) {
      dispatch(
        createTask({
          projectId: project.id,
          title,
          parentId: addingForParentId || taskId,
          status: STATUS_TODO,
        })
      );
    }
    setNewTitle("");
    setAddingForParentId(null);
  }, [newTitle, project, addingForParentId, taskId, dispatch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setNewTitle("");
      setAddingForParentId(null);
    }
  }, [handleSubmit]);

  const handleToggle = useCallback((subtask: Task) => {
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
  }, [dispatch]);

  const handleCreateSubtask = useCallback((parentId: string) => {
    setAddingForParentId(parentId);
    setNewTitle("");
  }, []);

  const completedCount = parentCompleted
    ? subtasks.length
    : subtasks.filter((t) => t.completedAt).length;

  // Determine if root-level inline add is active
  const isRootAdding = addingForParentId === taskId;

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
            depth={0}
            onToggle={handleToggle}
            onCreateSubtask={handleCreateSubtask}
            parentCompleted={parentCompleted}
            addingForParentId={addingForParentId}
            newTitle={newTitle}
            onNewTitleChange={setNewTitle}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
            inputRef={inputRef}
          />
        ))}

        {isRootAdding && (
          <div className="flex items-center gap-2 py-1 px-2">
            <span className="w-3 shrink-0" />
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

      {!addingForParentId && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground h-8 px-2 hover:bg-transparent hover:text-foreground"
          onClick={() => handleCreateSubtask(taskId)}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add subtask
        </Button>
      )}
    </div>
  );
}

interface SubtaskItemProps {
  task: Task;
  depth: number;
  onToggle: (task: Task) => void;
  onCreateSubtask: (parentId: string) => void;
  parentCompleted?: boolean;
  addingForParentId: string | null;
  newTitle: string;
  onNewTitleChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function SubtaskItem({
  task,
  depth,
  onToggle,
  onCreateSubtask,
  parentCompleted,
  addingForParentId,
  newTitle,
  onNewTitleChange,
  onKeyDown,
  onSubmit,
  inputRef,
}: SubtaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const subtasks = useAppSelector(selectSubtasksByParentId(task.id));
  const hasChildren = task.subtaskTotal > 0;
  const isCompleted = parentCompleted || !!task.completedAt;
  const canExpand = hasChildren && depth < MAX_DEPTH;
  const isAddingHere = addingForParentId === task.id;

  return (
    <div>
      <div
        className="group flex items-center gap-2 py-1 rounded-md hover:bg-muted/50"
        style={{ paddingLeft: 8 + depth * 16, paddingRight: 8 }}
      >
        {/* Expand/collapse chevron */}
        {canExpand ? (
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Completion toggle */}
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

        {/* Subtask count badge */}
        {hasChildren && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {task.subtaskCompleted}/{task.subtaskTotal}
          </span>
        )}

        {/* Add child button (hover-only, hidden at max depth) */}
        {depth < MAX_DEPTH && (
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-foreground transition-all shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onCreateSubtask(task.id);
            }}
            title="Add child subtask"
          >
            <Plus size={12} />
          </button>
        )}
      </div>

      {/* Recursive children */}
      {isExpanded && canExpand && subtasks.map((child) => (
        <SubtaskItem
          key={child.id}
          task={child}
          depth={depth + 1}
          onToggle={onToggle}
          onCreateSubtask={onCreateSubtask}
          parentCompleted={parentCompleted || isCompleted}
          addingForParentId={addingForParentId}
          newTitle={newTitle}
          onNewTitleChange={onNewTitleChange}
          onKeyDown={onKeyDown}
          onSubmit={onSubmit}
          inputRef={inputRef}
        />
      ))}

      {/* Inline input for adding child to this item */}
      {isAddingHere && (
        <div
          className="flex items-center gap-2 py-1"
          style={{ paddingLeft: 8 + (depth + 1) * 16, paddingRight: 8 }}
        >
          <span className="w-4 shrink-0" />
          <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => onNewTitleChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onSubmit}
            placeholder="Subtask title..."
            className="flex-1 text-sm bg-transparent outline-none border-b border-primary text-foreground placeholder:text-muted-foreground pb-0.5"
          />
        </div>
      )}
    </div>
  );
}
