import { useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { TaskHit } from "@/features/projects/hooks/useTaskSearch";
import { selectTaskListLoadedIds } from "@/features/projects/store/projectsSlice";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";

/** Sample pages asked for in this session, so concurrent callers and re-renders ask once. */
const requested = new Set<string>();

/** Called by the session reset so a new sign-in loads the pages again. */
export function clearRequestedTaskPages(): void {
  requested.clear();
}

/**
 * The person's open tasks across their projects, newest change first. One sample page per
 * project keeps it cheap; a project opened earlier already holds all its tasks.
 */
export function useAssignedTasks(): TaskHit[] {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.auth.user?.id ?? "");
  const projects = useAppSelector((state) => state.projects.projects);
  const tasks = useAppSelector((state) => state.projects.tasks);
  const loadedIds = useAppSelector(selectTaskListLoadedIds);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId ?? "");

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  useEffect(() => {
    for (const projectId of Object.keys(projects)) {
      const key = `${organizationId}:${projectId}`;
      // The loaded flag only lands when a page arrives; without this every arrival would ask
      // again for each project still in flight, and the burst starves the other requests.
      if (loadedIds[projectId] || requested.has(key)) continue;
      requested.add(key);
      void dispatch(fetchProjectTasks({ projectId, firstPageOnly: true })).then((result) => {
        if (fetchProjectTasks.rejected.match(result)) requested.delete(key);
      });
    }
  }, [dispatch, projects, loadedIds, organizationId]);

  return useMemo(
    () =>
      Object.values(tasks)
        .filter((task) => !task.completedAt && task.assigneeIds.includes(userId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((task) => {
          const project = projects[task.projectId];
          return {
            id: task.id,
            title: task.title,
            code: project?.slug ? `${project.slug.toUpperCase()}-${task.number}` : null,
            type: task.taskType || "task",
            projectId: task.projectId,
            projectName: project?.name ?? "",
          };
        }),
    [tasks, projects, userId],
  );
}
