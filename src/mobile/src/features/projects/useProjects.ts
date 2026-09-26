import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { useAuth } from "@core/providers/AuthContext";
import { projectQueryKey } from "@features/projects/projectViewsCache";
import { useDateTimePrefs } from "@core/datetimePrefs";
import { sessionGeneration } from "@core/auth/sessionScope";
import { zonedDayKey } from "@shared/lib/zonedTime";
import { fetchAllPages } from "@shared/lib/fetchAllPages";
import { projectsApi } from "@features/projects/projectsApi";
import {
  projectToPlain,
  taskToPlain,
  activityToPlain,
  sprintToPlain,
  type SerializedFieldDefinition,
} from "@features/projects/projectsSerializer";
import { resultKey, shapesResults, viewQueryDefinition } from "@features/projects/viewDefinition";

export function useProjectsList() {
  const { organizationId, user } = useAuth();

  return useQuery({
    queryKey: ["projects", organizationId, user?.id],
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
  const { organizationId, user } = useAuth();

  return useQuery({
    queryKey: projectQueryKey(organizationId, projectId, user?.id),
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

/** Unfiltered views reuse the project list; shaped views retain rows during filter changes. */
export function useViewTasks(
  projectId: string | undefined,
  definition: ViewDefinition,
  fields: SerializedFieldDefinition[] | undefined,
) {
  const { organizationId, user } = useAuth();
  const { timeZone, weekStartsOn } = useDateTimePrefs();
  const generation = sessionGeneration();
  const today = zonedDayKey(new Date(), timeZone);
  const active = shapesResults(definition);
  const request = useMemo(
    () => viewQueryDefinition(definition, fields ?? []),
    [definition, fields],
  );

  return useQuery({
    // Under the project's task key, so every task mutation that refreshes the list refreshes this too.
    queryKey: [
      "tasks",
      organizationId,
      projectId,
      "view",
      user?.id,
      generation,
      timeZone,
      weekStartsOn,
      today,
      resultKey(request),
    ],
    queryFn: async ({ signal }) => {
      const tasks = await fetchAllPages(
        async (page) => {
          const response = await projectsApi.listTasks(
            {
              organizationId: organizationId!,
              projectId: projectId!,
              pagination: { page, pageSize: TASK_PAGE_SIZE },
              filter: request.filter,
              sort: request.sort,
              timeZone,
            },
            { signal },
          );
          return { items: response.tasks, totalPages: response.pagination?.totalPages ?? 1 };
        },
        { key: (task) => task.id },
      );
      return tasks.map(taskToPlain);
    },
    enabled: !!organizationId && !!user && !!projectId && !!fields && active,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId &&
      query.queryKey[2] === projectId &&
      query.queryKey[4] === user?.id &&
      query.queryKey[5] === generation
        ? previous
        : undefined,
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
