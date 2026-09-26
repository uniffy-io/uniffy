import { Alert } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Code, ConnectError } from "@connectrpc/connect";
import { useAuth } from "@core/providers/AuthContext";
import { isCurrentSession } from "@core/auth/sessionScope";
import {
  projectQueryKey,
  storeProjectView,
  type ProjectViewScope,
} from "@features/projects/projectViewsCache";
import { projectsApi } from "@features/projects/projectsApi";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import {
  getStatusOptions,
  viewToPlain,
  visibilityStringToProto,
} from "@features/projects/projectsSerializer";
import type { SerializedProject, SerializedTask } from "@features/projects/projectsSerializer";
import { isCompletedStatus } from "@features/projects/statusSemantics";
import type { TaskMove } from "@features/projects/taskOrdering";
import type { GroupDrop } from "@features/projects/taskGrouping";

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
    onError: (error) => {
      Alert.alert("Could not create project", serverMessage(error, "The project was not created"));
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
    onError: (error) => {
      Alert.alert("Could not save project", serverMessage(error, "The changes were not saved"));
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
    onError: (error) => {
      Alert.alert("Could not delete project", serverMessage(error, "The project was not deleted"));
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
    onError: (error) => {
      Alert.alert("Could not create task", serverMessage(error, "The task was not created"));
    },
  });
}

export function useUpdateTask() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      taskId: string;
      /** Not sent to the server - it scopes which task list gets invalidated. */
      projectId: string;
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
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["task", organizationId, variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-activities", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      Alert.alert("Could not save task", serverMessage(error, "The changes were not saved"));
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
    onError: (error) => {
      Alert.alert("Could not delete task", serverMessage(error, "The task was not deleted"));
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
    onError: (error) => {
      Alert.alert("Could not save field", serverMessage(error, "The changes were not saved"));
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
    onError: (error) => {
      Alert.alert("Could not update tasks", serverMessage(error, "The tasks were not updated"));
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
    onError: (error) => {
      Alert.alert("Could not delete tasks", serverMessage(error, "The tasks were not deleted"));
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
    onError: (error) => {
      Alert.alert("Could not update watchers", serverMessage(error, "The change was not saved"));
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
  const { organizationId, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { projectId: string; moves: TaskMove[] }) => {
      // MoveTask takes one task at a time; only a respaced column ever sends
      // more than one, and those writes are independent of each other. Issued
      // together rather than in sequence: a 200-task respace over LTE is 200
      // round trips, and a failure part-way through a serial loop would leave
      // the column half-respaced with no signal.
      await Promise.all(
        args.moves.map((move) =>
          projectsApi.moveTask({
            organizationId: organizationId!,
            taskId: move.taskId,
            status: move.status,
            sortOrder: move.sortOrder,
          }),
        ),
      );
    },
    onMutate: async (args) => {
      const key = ["tasks", organizationId, args.projectId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueriesData<SerializedTask[]>({ queryKey: key });
      const statusOptions = getStatusOptions(
        queryClient.getQueryData<SerializedProject>(
          projectQueryKey(organizationId, args.projectId, user?.id),
        ),
      );

      // A card that snaps back to where it started while the round trip runs
      // reads as a rejected drop, so the drop is applied locally first.
      queryClient.setQueriesData<SerializedTask[]>({ queryKey: key }, (tasks) => {
        if (!tasks) return tasks;
        const byId = new Map(args.moves.map((m) => [m.taskId, m]));
        return tasks.map((task) => {
          const move = byId.get(task.id);
          if (!move) return task;
          const wasDone = isCompletedStatus(statusOptions, task.status);
          const isDone = isCompletedStatus(statusOptions, move.status);
          return {
            ...task,
            status: move.status,
            sortOrder: move.sortOrder,
            // Mirrors what the server stamps, so progress, blocked markers and the
            // struck-through title update with the drop rather than a round trip later.
            completedAt:
              isDone === wasDone ? task.completedAt : isDone ? new Date().toISOString() : undefined,
          };
        });
      });

      return { previous };
    },
    onError: (error, _args, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
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

/**
 * Writes the value of the group a task was dropped on. Applied to every loaded list of the
 * project first, so the row lands in its new group without waiting for the round trip.
 */
export function useDropTaskOnGroup() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  const patch = (task: SerializedTask, drop: Exclude<GroupDrop, { kind: "status" }>) => {
    switch (drop.kind) {
      case "priority":
        return { ...task, priority: drop.priority };
      case "sprint":
        return { ...task, sprintId: drop.sprintId ?? undefined };
      case "select":
        return {
          ...task,
          fieldValues: { ...task.fieldValues, [drop.fieldId]: drop.optionId ?? "" },
        };
    }
  };

  return useMutation({
    mutationFn: (args: {
      projectId: string;
      taskId: string;
      drop: Exclude<GroupDrop, { kind: "status" }>;
    }) => {
      const { drop } = args;
      return projectsApi.updateTask({
        organizationId: organizationId!,
        taskId: args.taskId,
        priority: drop.kind === "priority" ? drop.priority : undefined,
        // Absent leaves the sprint alone, so clearing it has to send "".
        sprintId: drop.kind === "sprint" ? (drop.sprintId ?? "") : undefined,
        // Custom values travel JSON-encoded; null clears the field.
        fieldValues:
          drop.kind === "select" ? { [drop.fieldId]: JSON.stringify(drop.optionId) } : undefined,
      });
    },
    onMutate: async (args) => {
      const key = ["tasks", organizationId, args.projectId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueriesData<SerializedTask[]>({ queryKey: key });
      queryClient.setQueriesData<SerializedTask[]>({ queryKey: key }, (tasks) =>
        tasks?.map((task) => (task.id === args.taskId ? patch(task, args.drop) : task)),
      );
      return { previous };
    },
    onError: (error, _args, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
      Alert.alert("Could not move task", serverMessage(error, "The task could not be moved"));
    },
    onSettled: (_data, _error, args) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", organizationId, args.projectId] });
      queryClient.invalidateQueries({ queryKey: ["sprints", organizationId, args.projectId] });
    },
  });
}

function requireViewSession(scope: ProjectViewScope): void {
  if (!isCurrentSession(scope.generation)) throw new Error("Session changed");
}

export function useCreateView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      scope: ProjectViewScope;
      projectId: string;
      name: string;
      definition: ViewDefinition;
    }) => {
      requireViewSession(args.scope);
      const response = await projectsApi.createView({
        organizationId: args.scope.organizationId,
        projectId: args.projectId,
        name: args.name,
        definition: args.definition,
        visibility: ViewVisibility.PERSONAL,
      });
      if (!response.view) throw new Error("The view was not created");
      return viewToPlain(response.view);
    },
    onSuccess: (view, args) => storeProjectView(queryClient, args.scope, args.projectId, { view }),
    onError: (error, args) => {
      if (!isCurrentSession(args.scope.generation)) return;
      Alert.alert("Could not save view", serverMessage(error, "The view was not created"));
    },
  });
}

export function useUpdateView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      scope: ProjectViewScope;
      projectId: string;
      viewId: string;
      name?: string;
      definition?: ViewDefinition;
    }) => {
      requireViewSession(args.scope);
      const response = await projectsApi.updateView({
        organizationId: args.scope.organizationId,
        projectId: args.projectId,
        viewId: args.viewId,
        name: args.name,
        definition: args.definition,
      });
      if (!response.view) throw new Error("The view was not saved");
      return viewToPlain(response.view);
    },
    onSuccess: (view, args) => storeProjectView(queryClient, args.scope, args.projectId, { view }),
    onError: (error, args) => {
      if (!isCurrentSession(args.scope.generation)) return;
      Alert.alert("Could not save view", serverMessage(error, "The changes were not saved"));
    },
  });
}

export function useDeleteView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { scope: ProjectViewScope; projectId: string; viewId: string }) => {
      requireViewSession(args.scope);
      return projectsApi.deleteView({
        organizationId: args.scope.organizationId,
        projectId: args.projectId,
        viewId: args.viewId,
      });
    },
    onSuccess: (_data, args) =>
      storeProjectView(queryClient, args.scope, args.projectId, { removedId: args.viewId }),
    onError: (error, args) => {
      if (!isCurrentSession(args.scope.generation)) return;
      Alert.alert("Could not delete view", serverMessage(error, "The view was not deleted"));
    },
  });
}
