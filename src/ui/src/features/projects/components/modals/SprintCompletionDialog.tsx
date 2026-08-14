import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { completeSprint } from "@/features/projects/store/sprintsThunks";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import type { Sprint, Task } from "@/features/projects/types";

interface SprintCompletionDialogProps {
  sprint: Sprint;
  projectId: string;
  projectSlug: string;
  incompleteTasks: Task[];
  onClose: () => void;
}

export function SprintCompletionDialog({
  sprint,
  projectId,
  projectSlug,
  incompleteTasks,
  onClose,
}: SprintCompletionDialogProps) {
  const dispatch = useAppDispatch();
  const allSprints = useAppSelector(selectSprintsForProject(projectId));
  const plannedSprints = allSprints.filter((s) => s.status === "planned" && s.id !== sprint.id);

  // For each incomplete task: "backlog" or a sprint ID
  const [dispositions, setDispositions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const task of incompleteTasks) {
      initial[task.id] = "backlog";
    }
    return initial;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Move incomplete tasks
      for (const task of incompleteTasks) {
        const destination = dispositions[task.id];
        const sprintId = destination === "backlog" ? null : destination;
        if (sprintId !== task.sprintId) {
          await dispatch(updateTask({ id: task.id, sprintId })).unwrap();
        }
      }
      // Complete the sprint
      await dispatch(completeSprint(sprint.id)).unwrap();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl p-6 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-lg font-semibold text-foreground">Complete Sprint</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {incompleteTasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-6">
            <p className="text-sm text-muted-foreground mb-6">
              All tasks are complete. The sprint can be closed.
            </p>
            <Button onClick={handleComplete} disabled={isSubmitting}>
              {isSubmitting ? "Completing..." : "Complete Sprint"}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4 shrink-0">
              {incompleteTasks.length} incomplete task{incompleteTasks.length !== 1 ? "s" : ""} will
              be moved. Choose a destination for each:
            </p>

            <div className="flex-1 overflow-y-auto divide-y divide-border border border-border rounded-lg mb-4">
              {incompleteTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground shrink-0 w-16">
                    {projectSlug}-{task.number}
                  </span>
                  <span className="text-sm text-foreground truncate flex-1 min-w-0">
                    {task.title}
                  </span>
                  <select
                    value={dispositions[task.id]}
                    onChange={(e) =>
                      setDispositions((prev) => ({ ...prev, [task.id]: e.target.value }))
                    }
                    className="text-sm border border-border rounded-md px-2 py-1 bg-card text-foreground shrink-0"
                  >
                    <option value="backlog">Move to Backlog</option>
                    {plannedSprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        Move to {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 shrink-0">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleComplete} disabled={isSubmitting}>
                {isSubmitting ? "Completing..." : "Complete Sprint"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
