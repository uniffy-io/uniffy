import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import { visibilityStringToProto } from "@features/projects/projectsSerializer";

export function useCreateProject() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      name: string;
      description?: string;
      icon?: string;
      color?: string;
      visibility?: string;
    }) =>
      projectsApi.createProject({
        organizationId: organizationId!,
        name: args.name,
        description: args.description,
        icon: args.icon,
        color: args.color,
        accessMode: args.visibility ? visibilityStringToProto(args.visibility) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateProject() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      projectId: string;
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      visibility?: string;
    }) =>
      projectsApi.updateProject({
        organizationId: organizationId!,
        projectId: args.projectId,
        name: args.name,
        description: args.description,
        icon: args.icon,
        color: args.color,
        accessMode: args.visibility ? visibilityStringToProto(args.visibility) : undefined,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", organizationId, variables.projectId] });
    },
  });
}

export function useDeleteProject() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      projectsApi.deleteProject({
        organizationId: organizationId!,
        projectId,
        permanent: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCreateTask() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      projectId: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeIds?: string[];
      startDate?: string;
      dueDate?: string;
      parentId?: string;
      taskType?: string;
      sprintId?: string;
      estimatedMinutes?: number;
      tagIds?: string[];
    }) =>
      projectsApi.createTask({
        organizationId: organizationId!,
        projectId: args.projectId,
        title: args.title,
        description: args.description,
        status: args.status,
        priority: args.priority,
        assigneeIds: args.assigneeIds ?? [],
        startDate: args.startDate,
        dueDate: args.dueDate,
        parentId: args.parentId,
        taskType: args.taskType,
        sprintId: args.sprintId,
        estimatedMinutes: args.estimatedMinutes,
        tagIds: args.tagIds ?? [],
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateTask() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      taskId: string;
      projectId?: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assigneeIds?: string[];
      startDate?: string | null;
      dueDate?: string | null;
      sortOrder?: number;
      taskType?: string;
      sprintId?: string | null;
      parentId?: string | null;
      blockedByTaskIds?: string[];
      estimatedMinutes?: number | null;
      timeSpentMinutes?: number | null;
      tagIds?: string[];
      recurrenceRule?: string | null;
    }) =>
      projectsApi.updateTask({
        organizationId: organizationId!,
        taskId: args.taskId,
        title: args.title,
        description: args.description,
        status: args.status,
        priority: args.priority,
        assigneeIds: args.assigneeIds ? { ids: args.assigneeIds } : undefined,
        startDate: args.startDate !== undefined ? (args.startDate ?? "") : undefined,
        dueDate: args.dueDate !== undefined ? (args.dueDate ?? "") : undefined,
        sortOrder: args.sortOrder,
        taskType: args.taskType,
        // Clearing a relation sends "" - the field must be present for the
        // server to see the change, and absent to leave it untouched.
        sprintId: args.sprintId !== undefined ? (args.sprintId ?? "") : undefined,
        parentId: args.parentId !== undefined ? (args.parentId ?? "") : undefined,
        blockedByTaskIds: args.blockedByTaskIds,
        estimatedMinutes:
          args.estimatedMinutes !== undefined ? (args.estimatedMinutes ?? 0) : undefined,
        timeSpentMinutes:
          args.timeSpentMinutes !== undefined ? (args.timeSpentMinutes ?? 0) : undefined,
        tagIds: args.tagIds ? { ids: args.tagIds } : undefined,
        recurrenceRule: args.recurrenceRule !== undefined ? (args.recurrenceRule ?? "") : undefined,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", organizationId, variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activities", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteTask() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { taskId: string; projectId: string }) =>
      projectsApi.deleteTask({
        organizationId: organizationId!,
        taskId: args.taskId,
        permanent: false,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateField() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { projectId: string; fieldId: string; configJson: string }) =>
      projectsApi.updateField({
        organizationId: organizationId!,
        projectId: args.projectId,
        fieldId: args.fieldId,
        configJson: args.configJson,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["project", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useBulkUpdateTasks() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      projectId: string;
      taskIds: string[];
      status?: string;
      priority?: string;
      // Replaces the assignee set. The server ignores an empty list, so this
      // cannot be used to clear assignees.
      assigneeIds?: string[];
    }) =>
      projectsApi.bulkUpdateTasks({
        organizationId: organizationId!,
        taskIds: args.taskIds,
        status: args.status,
        priority: args.priority,
        assigneeIds: args.assigneeIds,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteTasks() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { projectId: string; taskIds: string[] }) =>
      projectsApi.deleteTasks({
        organizationId: organizationId!,
        taskIds: args.taskIds,
        permanent: false,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useToggleTaskWatcher() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) =>
      projectsApi.toggleTaskWatcher({ organizationId: organizationId!, taskId }),
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ["task-watchers", organizationId, taskId] });
    },
  });
}

export function useMoveTask() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { taskId: string; status: string; sortOrder: number }) =>
      projectsApi.moveTask({
        organizationId: organizationId!,
        taskId: args.taskId,
        status: args.status,
        sortOrder: args.sortOrder,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
