import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";
import { useAuth } from "@core/providers/AuthContext";
import { projectsApi } from "@features/projects/projectsApi";
import { DONE_STATUS_ID, visibilityStringToProto } from "@features/projects/projectsSerializer";
import type { SerializedTask } from "@features/projects/projectsSerializer";
import type { TaskMove } from "@features/projects/taskOrdering";

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

/**
 * The server states its refusals in full - "a sprint is already active", the
 * names of a task's unresolved blockers - and wraps them in a field prefix that
 * means nothing to a reader. Strip the prefix, keep the sentence.
 */
function serverMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof ConnectError ? error.rawMessage : error instanceof Error ? error.message : "";
  if (!raw) return fallback;
  return raw.match(/Validation error on '[^']+': (.+)/)?.[1] ?? raw;
}

function moveErrorMessage(error: unknown): string {
  if (error instanceof ConnectError) {
    if (error.code === Code.PermissionDenied) {
      return error.rawMessage || "You do not have permission to move this task";
    }
    // The server explains an unresolved-blocker rejection by naming the
    // blockers, which is the whole value of the message.
    return error.rawMessage || "The task could not be moved";
  }
  if (error instanceof Error && error.message) return error.message;
  return "The task could not be moved";
}

export function useMoveTasks() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { projectId: string; moves: TaskMove[] }) => {
      // MoveTask takes one task at a time; only a respaced column ever sends
      // more than one, and those writes are independent of each other.
      for (const move of args.moves) {
        await projectsApi.moveTask({
          organizationId: organizationId!,
          taskId: move.taskId,
          status: move.status,
          sortOrder: move.sortOrder,
        });
      }
    },
    onMutate: async (args) => {
      const key = ["tasks", organizationId, args.projectId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SerializedTask[]>(key);

      // A card that snaps back to where it started while the round trip runs
      // reads as a rejected drop, so the drop is applied locally first.
      queryClient.setQueryData<SerializedTask[]>(key, (tasks) => {
        if (!tasks) return tasks;
        const byId = new Map(args.moves.map((m) => [m.taskId, m]));
        return tasks.map((task) => {
          const move = byId.get(task.id);
          if (!move) return task;
          const wasDone = !!task.completedAt;
          const isDone = move.status === DONE_STATUS_ID;
          return {
            ...task,
            status: move.status,
            sortOrder: move.sortOrder,
            // Mirrors what the server stamps, so progress and the struck-through
            // title update with the drop rather than a round trip later.
            completedAt: isDone
              ? (task.completedAt ?? new Date().toISOString())
              : wasDone
                ? undefined
                : task.completedAt,
          };
        });
      });

      return { previous, key };
    },
    onError: (error, _args, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      Alert.alert("Could not move task", moveErrorMessage(error));
    },
    onSettled: (_data, _error, args) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/**
 * Every sprint write moves tasks between sprints or flips their status, so the
 * task list is refetched alongside the sprint list on all of them.
 */
function useSprintMutation<TArgs extends { projectId: string }>(
  title: string,
  run: (organizationId: string, args: TArgs) => Promise<unknown>,
) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: TArgs) => run(organizationId!, args),
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: ["sprints", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      Alert.alert(title, serverMessage(error, "The sprint could not be updated"));
    },
  });
}

export function useCreateSprint() {
  return useSprintMutation<{
    projectId: string;
    name: string;
    goal?: string;
    startDate?: string;
    endDate?: string;
  }>("Could not create sprint", (organizationId, args) =>
    projectsApi.createSprint({
      organizationId,
      projectId: args.projectId,
      name: args.name,
      goal: args.goal,
      startDate: args.startDate,
      endDate: args.endDate,
    }),
  );
}

export function useStartSprint() {
  return useSprintMutation<{ projectId: string; sprintId: string }>(
    "Could not start sprint",
    (organizationId, args) => projectsApi.startSprint({ organizationId, sprintId: args.sprintId }),
  );
}

export function useCompleteSprint() {
  return useSprintMutation<{ projectId: string; sprintId: string }>(
    "Could not complete sprint",
    (organizationId, args) =>
      projectsApi.completeSprint({ organizationId, sprintId: args.sprintId }),
  );
}

export function useDeleteSprint() {
  return useSprintMutation<{ projectId: string; sprintId: string }>(
    "Could not delete sprint",
    (organizationId, args) => projectsApi.deleteSprint({ organizationId, sprintId: args.sprintId }),
  );
}

/**
 * Reassigns tasks one at a time, which is what closing a sprint needs: the
 * incomplete work is dispersed to different destinations before the sprint
 * itself is closed.
 */
export function useMoveTasksToSprint() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      projectId: string;
      moves: { taskId: string; sprintId: string | null }[];
    }) => {
      for (const move of args.moves) {
        await projectsApi.updateTask({
          organizationId: organizationId!,
          taskId: move.taskId,
          // Absent leaves the sprint alone, so clearing it has to send "".
          sprintId: move.sprintId ?? "",
        });
      }
    },
    onSuccess: (_data, args) => {
      queryClient.invalidateQueries({ queryKey: ["sprints", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      Alert.alert("Could not move tasks", serverMessage(error, "The tasks could not be moved"));
    },
  });
}
