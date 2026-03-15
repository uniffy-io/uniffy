import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { projectsApi } from "@/api/projectsApi";
import { visibilityStringToProto } from "@/lib/projectsSerializer";

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
        visibility: args.visibility ? visibilityStringToProto(args.visibility) : undefined,
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
        visibility: args.visibility ? visibilityStringToProto(args.visibility) : undefined,
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
    }) =>
      projectsApi.updateTask({
        organizationId: organizationId!,
        taskId: args.taskId,
        title: args.title,
        description: args.description,
        status: args.status,
        priority: args.priority,
        assigneeIds: args.assigneeIds,
        startDate: args.startDate !== undefined ? (args.startDate ?? "") : undefined,
        dueDate: args.dueDate !== undefined ? (args.dueDate ?? "") : undefined,
        sortOrder: args.sortOrder,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", organizationId, variables.taskId] });
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
