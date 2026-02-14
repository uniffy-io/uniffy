import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectTasksForProject,
  selectTasksByStatus,
  selectCurrentProjectId,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import {
  fetchProjectTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "@/features/projects/store/projectsThunks";
import { applyFilters } from "@/features/projects/utils/filterTasks";
import type { Task, CreateTaskRequest, UpdateTaskRequest, MoveTaskRequest } from "@/features/projects/types/project";

/**
 * Hook for managing tasks within the current project
 */
export function useTasks() {
  const dispatch = useAppDispatch();

  const currentProjectId = useAppSelector(selectCurrentProjectId);

  // Get tasks for current project
  const tasks = useAppSelector((state) =>
    currentProjectId ? selectTasksForProject(currentProjectId)(state) : []
  );

  // Get tasks grouped by status for current project
  const tasksByStatus = useAppSelector((state) =>
    currentProjectId ? selectTasksByStatus(currentProjectId)(state) : {}
  );

  const loadTasks = useCallback(
    (projectId?: string) => {
      const id = projectId || currentProjectId;
      if (id) {
        return dispatch(fetchProjectTasks(id));
      }
      return Promise.resolve();
    },
    [dispatch, currentProjectId]
  );

  const addTask = useCallback(
    (data: Omit<CreateTaskRequest, "projectId">) => {
      if (!currentProjectId) {
        return Promise.reject(new Error("No project selected"));
      }
      return dispatch(createTask({ ...data, projectId: currentProjectId }));
    },
    [dispatch, currentProjectId]
  );

  const editTask = useCallback(
    (data: UpdateTaskRequest) => {
      return dispatch(updateTask(data));
    },
    [dispatch]
  );

  const reorderTask = useCallback(
    (data: MoveTaskRequest) => {
      // Optimistic update
      dispatch(optimisticUpdateTask({ id: data.id, status: data.status, sortOrder: data.sortOrder }));
      return dispatch(moveTask(data));
    },
    [dispatch]
  );

  const removeTask = useCallback(
    (id: string) => {
      return dispatch(deleteTask(id));
    },
    [dispatch]
  );

  return {
    tasks,
    tasksByStatus,
    currentProjectId,
    loadTasks,
    addTask,
    editTask,
    reorderTask,
    removeTask,
  };
}

/**
 * Hook for filtering and sorting tasks
 */
export function useFilteredTasks(projectId: string) {
  const tasks = useAppSelector(selectTasksForProject(projectId));
  const searchQuery = useAppSelector((state) => state.projectsUi.searchQuery);
  const sortConfig = useAppSelector((state) => state.projectsUi.activeSortConfig);
  const filterConfig = useAppSelector((state) => state.projectsUi.activeFilterConfig);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query)
      );
    }

    // Apply filter conditions
    result = applyFilters(result, filterConfig);

    // Apply sorting
    if (sortConfig) {
      result.sort((a, b) => {
        const aVal = getFieldValue(a, sortConfig.fieldId);
        const bVal = getFieldValue(b, sortConfig.fieldId);

        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const comparison = aVal < bVal ? -1 : 1;
        return sortConfig.direction === "asc" ? comparison : -comparison;
      });
    } else {
      // Default: sort by sortOrder (asc)
      result.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return result;
  }, [tasks, searchQuery, sortConfig, filterConfig]);

  return filteredTasks;
}

/**
 * Get a field value from a task
 */
function getFieldValue(task: Task, fieldId: string): unknown {
  switch (fieldId) {
    case "field_title":
      return task.title;
    case "field_status":
      return task.status;
    case "field_priority":
      return task.priority;
    case "field_assignee":
      return task.assigneeIds[0];
    case "field_start_date":
      return task.startDate;
    case "field_due_date":
      return task.dueDate;
    default:
      return task.fieldValues[fieldId];
  }
}
