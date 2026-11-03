import { useCallback } from "react";
import { useAppDispatch } from "@/app/hooks";
import { optimisticUpdateTask } from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import type { Task } from "@/features/projects/types";

type TaskPatch = Partial<
  Pick<
    Task,
    | "status"
    | "priority"
    | "assigneeIds"
    | "dueDate"
    | "startDate"
    | "tagIds"
    | "taskType"
    | "sprintId"
    | "estimatedMinutes"
  >
>;

/** Applies a field change at once and saves it, the way every task field editor does. */
export function useTaskFieldUpdate(taskId: string) {
  const dispatch = useAppDispatch();
  return useCallback(
    (patch: TaskPatch) => {
      dispatch(optimisticUpdateTask({ id: taskId, ...patch }));
      void dispatch(updateTask({ id: taskId, ...patch }));
    },
    [dispatch, taskId],
  );
}
