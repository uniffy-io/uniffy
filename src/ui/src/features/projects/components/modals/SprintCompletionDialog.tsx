import { useState } from "react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { controlShellClass } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { cn } from "@/shared/utils/cn";
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
      for (const task of incompleteTasks) {
        const destination = dispositions[task.id];
        const sprintId = destination === "backlog" ? null : destination;
        if (sprintId !== task.sprintId) {
          await dispatch(updateTask({ id: task.id, sprintId })).unwrap();
        }
      }
      await dispatch(completeSprint(sprint.id)).unwrap();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      closeDisabled={isSubmitting}
      maxWidth="max-w-lg"
      className="flex flex-col max-h-[85dvh]"
    >
      <ModalHeader
        title="Complete sprint"
        description="Unfinished tasks are moved to the backlog or another sprint when this one closes."
      />

      <ModalBody scrollable={false} className="flex-1 min-h-0 flex flex-col">
        {incompleteTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All tasks are complete. The sprint can be closed.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground shrink-0">
              {incompleteTasks.length} incomplete task
              {incompleteTasks.length !== 1 ? "s" : ""} will be moved. Choose a destination for
              each.
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border border border-border rounded-lg">
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
                      setDispositions((prev) => ({
                        ...prev,
                        [task.id]: e.target.value,
                      }))
                    }
                    className={cn(
                      controlShellClass,
                      "focus-ring shrink-0 px-2 py-1 text-sm text-foreground",
                    )}
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
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="button" onClick={handleComplete} disabled={isSubmitting}>
          {isSubmitting ? "Completing..." : "Complete sprint"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
