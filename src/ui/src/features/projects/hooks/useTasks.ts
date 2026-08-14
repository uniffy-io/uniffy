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
import { applyFilters, buildTaskHierarchyIndex } from "@/features/projects/utils/filterTasks";
import type {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  MoveTaskRequest,
} from "@/features/projects/types/project";

export function useTasks() {
  const dispatch = useAppDispatch();

  const currentProjectId = useAppSelector(selectCurrentProjectId);

  const tasks = useAppSelector((state) =>
    currentProjectId ? selectTasksForProject(currentProjectId)(state) : [],
  );

  const tasksByStatus = useAppSelector((state) =>
    currentProjectId ? selectTasksByStatus(currentProjectId)(state) : {},
  );

  const loadTasks = useCallback(
    (projectId?: string) => {
      const id = projectId || currentProjectId;
      if (id) {
        return dispatch(fetchProjectTasks(id));
      }
      return Promise.resolve();
    },
    [dispatch, currentProjectId],
  );

  const addTask = useCallback(
    (data: Omit<CreateTaskRequest, "projectId">) => {
      if (!currentProjectId) {
        return Promise.reject(new Error("No project selected"));
      }
      return dispatch(createTask({ ...data, projectId: currentProjectId }));
    },
    [dispatch, currentProjectId],
  );

  const editTask = useCallback(
    (data: UpdateTaskRequest) => {
      return dispatch(updateTask(data));
    },
    [dispatch],
  );

  const reorderTask = useCallback(
    (data: MoveTaskRequest) => {
      dispatch(
        optimisticUpdateTask({
          id: data.id,
          status: data.status,
          sortOrder: data.sortOrder,
        }),
      );
      return dispatch(moveTask(data));
    },
    [dispatch],
  );

  const removeTask = useCallback(
    (id: string) => {
      return dispatch(deleteTask(id));
    },
    [dispatch],
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

interface UseFilteredTasksOptions {
  /** When true, subtasks (tasks with a parent) are included in the result. Defaults to false. */
  includeSubtasks?: boolean;
}

export function useFilteredTasks(projectId: string, options: UseFilteredTasksOptions = {}) {
  const { includeSubtasks = false } = options;
  const tasks = useAppSelector(selectTasksForProject(projectId));
  const searchQuery = useAppSelector((state) => state.projectsUi.searchQuery);
  const sortConfig = useAppSelector((state) => state.projectsUi.activeSortConfig);
  const filterConfig = useAppSelector((state) => state.projectsUi.activeFilterConfig);
  const sprintFilter = useAppSelector((state) => state.projectsUi.sprintFilter);
  const taskTypeFilter = useAppSelector((state) => state.projectsUi.taskTypeFilter);
  const rootOnlyFilter = useAppSelector((state) => state.projectsUi.rootOnlyFilter);
  const inEpicFilter = useAppSelector((state) => state.projectsUi.inEpicFilter);

  // Hierarchy index walks the full task set so ancestry stays correct when quick filters hide a parent.
  const hierarchyIndex = useMemo(() => buildTaskHierarchyIndex(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = includeSubtasks ? tasks.slice() : tasks.filter((t) => !t.parentId);

    if (rootOnlyFilter) {
      result = result.filter((t) => !t.parentId);
    }

    if (inEpicFilter) {
      result = result.filter(
        (t) => t.id === inEpicFilter || hierarchyIndex.ancestorIdsById.get(t.id)?.has(inEpicFilter),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          task.title.toLowerCase().includes(query) ||
          task.description.toLowerCase().includes(query),
      );
    }

    if (sprintFilter === "__backlog__") {
      result = result.filter((task) => task.sprintId === null);
    } else if (sprintFilter) {
      result = result.filter((task) => task.sprintId === sprintFilter);
    }

    if (taskTypeFilter) {
      result = result.filter((task) => (task.taskType || "task") === taskTypeFilter);
    }

    result = applyFilters(result, filterConfig, hierarchyIndex);

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
      result.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.number - b.number;
      });
    }

    return result;
  }, [
    tasks,
    searchQuery,
    sortConfig,
    filterConfig,
    sprintFilter,
    taskTypeFilter,
    rootOnlyFilter,
    inEpicFilter,
    includeSubtasks,
    hierarchyIndex,
  ]);

  return filteredTasks;
}

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
