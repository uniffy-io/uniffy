import { useState } from "react";
import { Play, CheckCircle, DotsThree, CaretDown, CaretRight } from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import {
  startSprint,
  deleteSprint,
} from "@/features/projects/store/sprintsThunks";
import { SprintCompletionDialog } from "@/features/projects/components/modals/SprintCompletionDialog";
import { BacklogTaskRow } from "@/features/projects/components/backlog/BacklogTaskRow";
import type { Sprint, Task } from "@/features/projects/types";

interface SprintCardProps {
  sprint: Sprint;
  tasks: Task[];
  projectId: string;
  projectSlug: string;
}

export function SprintCard({ sprint, tasks, projectId, projectSlug }: SprintCardProps) {
  const dispatch = useAppDispatch();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completedCount = tasks.filter((t) => t.status === "status_done").length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const dateRange =
    sprint.startDate && sprint.endDate
      ? `${sprint.startDate} – ${sprint.endDate}`
      : sprint.startDate
      ? `From ${sprint.startDate}`
      : sprint.endDate
      ? `Until ${sprint.endDate}`
      : null;

  const handleStartSprint = async () => {
    setIsStarting(true);
    setError(null);
    try {
      await dispatch(startSprint({ id: sprint.id })).unwrap();
    } catch (err: unknown) {
      const raw =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : String(err);
      // Extract the human-readable part after the field prefix
      const match = raw.match(/Validation error on '[^']+': (.+)/);
      setError(match ? match[1] : raw);
    } finally {
      setIsStarting(false);
    }
  };

  const handleDeleteSprint = async () => {
    await dispatch(deleteSprint({ sprintId: sprint.id, projectId })).unwrap();
  };

  const statusColor =
    sprint.status === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : "bg-muted text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
        </button>

        <span className="font-medium text-foreground flex-1 min-w-0 truncate">
          {sprint.name}
        </span>

        {dateRange && (
          <span className="text-xs text-muted-foreground shrink-0">{dateRange}</span>
        )}

        <span className="text-xs text-muted-foreground shrink-0">
          {completedCount}/{totalCount} ({progressPct}%)
        </span>

        <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium shrink-0", statusColor)}>
          {sprint.status}
        </span>

        {/* Progress bar */}
        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden shrink-0">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {sprint.status === "planned" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={handleStartSprint}
            disabled={isStarting}
          >
            <Play size={12} className="mr-1" />
            Start
          </Button>
        )}

        {sprint.status === "active" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={() => setIsCompletionDialogOpen(true)}
          >
            <CheckCircle size={12} className="mr-1" />
            Complete
          </Button>
        )}

        <div className="relative shrink-0">
          <button
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <DotsThree size={16} weight="bold" />
          </button>
          {isMenuOpen && (
            <div className="absolute right-0 top-7 z-50 w-32 rounded-md border border-border bg-card shadow-lg py-1">
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors"
                onClick={() => {
                  setIsMenuOpen(false);
                  handleDeleteSprint();
                }}
              >
                Delete Sprint
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-b border-border">
          {error}
        </div>
      )}

      {/* Task list */}
      {!isCollapsed && (
        <div className="divide-y divide-border">
          {tasks.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks in this sprint.
            </div>
          ) : (
            tasks.map((task) => (
              <BacklogTaskRow
                key={task.id}
                task={task}
                projectId={projectId}
                projectSlug={projectSlug}
                currentSprintId={sprint.id}
              />
            ))
          )}
        </div>
      )}

      {isCompletionDialogOpen && (
        <SprintCompletionDialog
          sprint={sprint}
          projectId={projectId}
          projectSlug={projectSlug}
          incompleteTasks={tasks.filter((t) => t.status !== "status_done")}
          onClose={() => setIsCompletionDialogOpen(false)}
        />
      )}
    </div>
  );
}
