import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { useAuth } from "@core/providers/AuthContext";
import { getEffectiveTimeZone } from "@core/datetimePrefs";
import { fetchAllPages } from "@shared/lib/fetchAllPages";
import { projectsApi } from "@features/projects/projectsApi";
import {
  projectToPlain,
  taskToPlain,
  activityToPlain,
  sprintToPlain,
} from "@features/projects/projectsSerializer";
import { resultKey, shapesResults } from "@features/projects/viewDefinition";

export function useProjectsList() {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["projects", organizationId],
    queryFn: async () => {
      const response = await projectsApi.listProjects({
        organizationId: organizationId!,
      });
      return response.projects.map(projectToPlain);
    },
    enabled: !!organizationId,
  });
}

export function useProject(projectId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["project", organizationId, projectId],
    queryFn: async () => {
      const response = await projectsApi.getProject({
        organizationId: organizationId!,
        projectId: projectId!,
      });
      if (!response.project) throw new Error("Project not found");
      return projectToPlain(response.project);
    },
    enabled: !!organizationId && !!projectId,
  });
}

// Each page must finish inside the default interactive RPC deadline on a mobile network.
const TASK_PAGE_SIZE = 500;

export function useProjectTasks(projectId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["tasks", organizationId, projectId],
    queryFn: async ({ signal }) => {
      const tasks = await fetchAllPages(
        async (page) => {
          const response = await projectsApi.listTasks(
            {
              organizationId: organizationId!,
              projectId: projectId!,
              pagination: { page, pageSize: TASK_PAGE_SIZE },
            },
            { signal },
          );
          return { items: response.tasks, totalPages: response.pagination?.totalPages ?? 1 };
        },
        { key: (task) => task.id },
      );
      return tasks.map(taskToPlain);
    },
    enabled: !!organizationId && !!projectId,
  });
}

/**
 * The view's tasks in the view's order, filtered and sorted by the server. Idle while the
 * definition neither filters nor sorts: the unfiltered list already answers that. The previous
 * result stays on screen while a changed filter is fetched.
 */
export function useViewTasks(projectId: string | undefined, definition: ViewDefinition) {
  const { organizationId } = useAuth();
  const active = shapesResults(definition);

  return useQuery({
    // Under the project's task key, so every task mutation that refreshes the list refreshes this too.
    queryKey: ["tasks", organizationId, projectId, "view", resultKey(definition)],
    queryFn: async ({ signal }) => {
      const tasks = await fetchAllPages(
        async (page) => {
          const response = await projectsApi.listTasks(
            {
              organizationId: organizationId!,
              projectId: projectId!,
              pagination: { page, pageSize: TASK_PAGE_SIZE },
              filter: definition.filter,
              sort: definition.sort,
              timeZone: getEffectiveTimeZone(),
            },
            { signal },
          );
          return { items: response.tasks, totalPages: response.pagination?.totalPages ?? 1 };
        },
        { key: (task) => task.id },
      );
      return tasks.map(taskToPlain);
    },
    enabled: !!organizationId && !!projectId && active,
    placeholderData: keepPreviousData,
  });
}

export function useTask(taskId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["task", organizationId, taskId],
    queryFn: async () => {
      const response = await projectsApi.getTask({
        organizationId: organizationId!,
        taskId: taskId!,
      });
      if (!response.task) throw new Error("Task not found");
      return taskToPlain(response.task);
    },
    enabled: !!organizationId && !!taskId,
  });
}

export function useProjectSprints(projectId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["sprints", organizationId, projectId],
    queryFn: async () => {
      const response = await projectsApi.listSprints({
        organizationId: organizationId!,
        projectId: projectId!,
        includeClosed: true,
      });
      return response.sprints.map(sprintToPlain);
    },
    enabled: !!organizationId && !!projectId,
  });
}

export function useTaskWatchers(taskId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["task-watchers", organizationId, taskId],
    queryFn: async () => {
      const response = await projectsApi.listTaskWatchers({
        organizationId: organizationId!,
        taskId: taskId!,
      });
      return {
        watcherIds: response.watcherUserIds,
        count: response.watcherCount,
      };
    },
    enabled: !!organizationId && !!taskId,
  });
}

export function useTaskActivities(taskId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["task-activities", organizationId, taskId],
    queryFn: async () => {
      const response = await projectsApi.listActivities({
        organizationId: organizationId!,
        taskId: taskId!,
      });
      return response.activities.map(activityToPlain);
    },
    enabled: !!organizationId && !!taskId,
  });
}
