import { useState, useRef, useEffect, useMemo } from "react";
import {
  LinkBreak,
  ArrowRight,
  WarningCircle,
  CheckCircle,
  Plus,
  X,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import {
  selectTasksMap,
  selectCurrentProject,
  selectTasksForProject,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/features/projects/types/project";

interface DependenciesListProps {
  taskId: string;
  blockedByTaskIds: string[];
  blocksTaskIds: string[];
}

export function DependenciesList({
  taskId,
  blockedByTaskIds,
  blocksTaskIds,
}: DependenciesListProps) {
  const dispatch = useAppDispatch();
  const hasBlockedBy = blockedByTaskIds.length > 0;
  const hasBlocks = blocksTaskIds.length > 0;

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // Once this task is complete it no longer holds anything up.
  const isComplete = useAppSelector((state) => !!selectTasksMap(state)[taskId]?.completedAt);

  const handleAddBlocker = (blockerId: string) => {
    const updated = [...blockedByTaskIds, blockerId];
    dispatch(optimisticUpdateTask({ id: taskId, blockedByTaskIds: updated }));
    dispatch(updateTask({ id: taskId, blockedByTaskIds: updated }));
    setIsPickerOpen(false);
  };

  const handleRemoveBlocker = (blockerId: string) => {
    const updated = blockedByTaskIds.filter((id) => id !== blockerId);
    dispatch(optimisticUpdateTask({ id: taskId, blockedByTaskIds: updated }));
    dispatch(updateTask({ id: taskId, blockedByTaskIds: updated }));
  };

  return (
    <div className="space-y-4">
      {/* Blocked By - always visible */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <LinkBreak size={12} />
          Blocked By
        </h3>

        {hasBlockedBy && (
          <div className="space-y-1.5">
            {blockedByTaskIds.map((id) => (
              <BlockedByItem key={id} taskId={id} onRemove={handleRemoveBlocker} />
            ))}
          </div>
        )}

        {isPickerOpen ? (
          <TaskPicker
            taskId={taskId}
            excludeIds={blockedByTaskIds}
            onSelect={handleAddBlocker}
            onClose={() => setIsPickerOpen(false)}
          />
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            onClick={() => setIsPickerOpen(true)}
          >
            <Plus size={12} />
            Add blocker
          </button>
        )}
      </div>

      {/* Blocks - read-only, only visible when non-empty */}
      {hasBlocks && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <ArrowRight size={12} />
            Blocks
          </h3>
          <div className="space-y-1.5">
            {blocksTaskIds.map((id) => (
              <BlocksItem key={id} taskId={id} blockerComplete={isComplete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskPickerProps {
  taskId: string;
  excludeIds: string[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

function TaskPicker({ taskId, excludeIds, onSelect, onClose }: TaskPickerProps) {
  const project = useAppSelector(selectCurrentProject);
  const projectId = project?.id;
  const selectTasks = useMemo(
    () => (projectId ? selectTasksForProject(projectId) : () => [] as Task[]),
    [projectId],
  );
  const allTasks = useAppSelector(selectTasks);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const excludeSet = useMemo(() => new Set([taskId, ...excludeIds]), [taskId, excludeIds]);

  const filtered = useMemo(() => {
    const lq = query.toLowerCase();
    return allTasks
      .filter((t) => !t.parentId && !excludeSet.has(t.id))
      .filter((t) => !lq || t.title.toLowerCase().includes(lq) || String(t.number).includes(lq));
  }, [allTasks, excludeSet, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-border bg-card shadow-md overflow-hidden"
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border">
        <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search tasks..."
          className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <div className="max-h-40 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matching tasks</div>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              onClick={() => onSelect(t.id)}
            >
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                #{t.number}
              </span>
              <span className="truncate">{t.title}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BlockedByItem({ taskId, onRemove }: { taskId: string; onRemove: (id: string) => void }) {
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);

  if (!task) return null;

  const isCompleted = !!task.completedAt;

  return (
    <div className="group flex items-center justify-between p-2 rounded-md border border-border bg-card gap-2">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">{task.title}</span>
        <span className="text-xs text-muted-foreground">#{task.number}</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isCompleted ? (
          <Badge variant="outline" className="text-xs bg-muted text-muted-foreground gap-1">
            <CheckCircle size={10} weight="fill" />
            Done
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-xs gap-1"
            style={{
              color: "var(--status-warning)",
              borderColor: "color-mix(in srgb, var(--status-warning) 50%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
            }}
          >
            <WarningCircle size={10} weight="fill" />
            Blocking
          </Badge>
        )}
        <button
          type="button"
          className="p-0.5 rounded text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:text-foreground hover:bg-muted transition-all"
          onClick={() => onRemove(taskId)}
          title="Remove blocker"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

function BlocksItem({ taskId, blockerComplete }: { taskId: string; blockerComplete: boolean }) {
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);

  if (!task) return null;

  const isCompleted = !!task.completedAt;

  return (
    <div className="flex items-center justify-between p-2 rounded-md border border-border bg-card gap-2">
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate">{task.title}</span>
        <span className="text-xs text-muted-foreground">#{task.number}</span>
      </div>

      {isCompleted ? (
        <Badge variant="outline" className="text-xs bg-muted text-muted-foreground gap-1 shrink-0">
          <CheckCircle size={10} weight="fill" />
          Done
        </Badge>
      ) : blockerComplete ? null : (
        <Badge
          variant="outline"
          className="text-xs border-blue-500/50 text-blue-600 bg-blue-500/10 gap-1 shrink-0"
        >
          Waiting
        </Badge>
      )}
    </div>
  );
}
