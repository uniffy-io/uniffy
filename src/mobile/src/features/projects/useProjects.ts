import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import {
  projectToPlain,
  taskToPlain,
  activityToPlain,
  sprintToPlain,
} from "@features/projects/projectsSerializer";

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

export function useProjectTasks(projectId: string | undefined) {
  const { organizationId } = useAuth();

  return useQuery({
    queryKey: ["tasks", organizationId, projectId],
    queryFn: async () => {
      const response = await projectsApi.listTasks({
        organizationId: organizationId!,
        projectId: projectId!,
      });
      return response.tasks.map(taskToPlain);
    },
    enabled: !!organizationId && !!projectId,
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
