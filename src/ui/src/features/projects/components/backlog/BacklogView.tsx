import { useState, useMemo } from "react";
import { Plus } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { selectCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  selectSprintsForProject,
  selectActiveSprint,
} from "@/features/projects/store/sprintsSlice";
import { fetchSprints } from "@/features/projects/store/sprintsThunks";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { SprintCard } from "@/features/projects/components/backlog/SprintCard";
import { BacklogTaskRow } from "@/features/projects/components/backlog/BacklogTaskRow";
import { CreateSprintModal } from "@/features/projects/components/modals/CreateSprintModal";
import type { Task } from "@/features/projects/types";

export function BacklogView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const [isCreateSprintOpen, setIsCreateSprintOpen] = useState(false);

  const allTasks = useFilteredTasks(project?.id ?? "");

  const sprints = useAppSelector(project ? selectSprintsForProject(project.id) : () => []);
  const activeSprint = useAppSelector(project ? selectActiveSprint(project.id) : () => null);

  const [showClosed, setShowClosed] = useState(false);

  const plannedSprints = useMemo(() => sprints.filter((s) => s.status === "planned"), [sprints]);

  const closedSprints = useMemo(() => sprints.filter((s) => s.status === "closed"), [sprints]);

  const backlogTasks = useMemo(() => allTasks.filter((t: Task) => t.sprintId === null), [allTasks]);

  if (!project) return null;

  const handleSprintCreated = () => {
    dispatch(fetchSprints(project.id));
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex flex-col gap-2 p-4">
        {/* Active sprint - pinned at top */}
        {activeSprint && (
          <SprintCard
            sprint={activeSprint}
            tasks={allTasks.filter((t: Task) => t.sprintId === activeSprint.id)}
            projectId={project.id}
            projectSlug={project.slug}
          />
        )}

        {/* Planned sprints */}
        {plannedSprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            tasks={allTasks.filter((t: Task) => t.sprintId === sprint.id)}
            projectId={project.id}
            projectSlug={project.slug}
          />
        ))}

        {/* Closed sprints toggle */}
        {closedSprints.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowClosed(!showClosed)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-1 py-1"
            >
              <span>
                {showClosed ? "Hide" : "Show"} closed sprints ({closedSprints.length})
              </span>
            </button>
            {showClosed &&
              closedSprints.map((sprint) => (
                <SprintCard
                  key={sprint.id}
                  sprint={sprint}
                  tasks={allTasks.filter((t: Task) => t.sprintId === sprint.id)}
                  projectId={project.id}
                  projectSlug={project.slug}
                />
              ))}
          </>
        )}

        {/* Backlog section */}
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Backlog</span>
              <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded-full">
                {backlogTasks.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-border">
            {backlogTasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No tasks in backlog. Create tasks or move them here from a sprint.
              </div>
            ) : (
              backlogTasks.map((task: Task) => (
                <BacklogTaskRow
                  key={task.id}
                  task={task}
                  projectId={project.id}
                  projectSlug={project.slug}
                  currentSprintId={null}
                />
              ))
            )}
          </div>
        </div>

        {/* Create Sprint button */}
        <Button
          variant="ghost"
          className="w-full border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground justify-center py-6"
          onClick={() => setIsCreateSprintOpen(true)}
        >
          <Plus size={16} className="mr-2" />
          Create Sprint
        </Button>
      </div>

      {isCreateSprintOpen && (
        <CreateSprintModal
          projectId={project.id}
          onClose={() => setIsCreateSprintOpen(false)}
          onCreated={handleSprintCreated}
        />
      )}
    </div>
  );
}
