import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  selectTasksForProject,
  selectTasksByStatus,
  selectCurrentProjectId,
  selectTasksMap,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import {
  selectActiveSprint,
  selectSprintsForProject,
} from "@/features/projects/store/sprintsSlice";
import { selectDraftFilter, selectDraftSort } from "@/features/projects/store/viewSelectors";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { getWeekStartsOn } from "@/shared/utils/weekStart";
import {
  fetchProjectTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "@/features/projects/store/projectsThunks";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import {
  applyFilters,
  buildTaskHierarchyIndex,
  type FilterContext,
} from "@/features/projects/utils/filterTasks";
import { personSortIds, sortTasks } from "@/features/projects/utils/sortTasks";
import { taskMatchesSearch } from "@/features/projects/utils/taskSearch";
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

/** Everything the view filter needs beyond the task itself, for the given project. */
export function useTaskFilterContext(projectId: string, tasks: Task[]): FilterContext {
  const fieldDefinitions = useAppSelector(
    (state) => state.projects.projects[projectId]?.fieldDefinitions,
  );
  const tasksById = useAppSelector(selectTasksMap);
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? null);
  const activeSprintId = useAppSelector(
    (state) => selectActiveSprint(projectId)(state)?.id ?? null,
  );
  const today = effectiveDayKey(new Date());

  // Hierarchy index walks the full task set so ancestry stays correct when a filter hides a parent.
  const hierarchy = useMemo(() => buildTaskHierarchyIndex(tasks), [tasks]);
  const fieldsById = useMemo(
    () => new Map((fieldDefinitions ?? []).map((field) => [field.id, field])),
    [fieldDefinitions],
  );

  return useMemo(
    () => ({
      hierarchy,
      fieldsById,
      lookup: (id: string) => tasksById[id],
      currentUserId,
      activeSprintId,
      today,
      weekStartsOn: getWeekStartsOn(),
    }),
    [hierarchy, fieldsById, tasksById, currentUserId, activeSprintId, today],
  );
}

/** The open view's tasks: its draft filter and sort, plus the transient search. */
export function useFilteredTasks(projectId: string, options: UseFilteredTasksOptions = {}) {
  const { includeSubtasks = false } = options;
  // One selector instance per project, so the task array keeps its identity between renders.
  const selectProjectTasks = useMemo(() => selectTasksForProject(projectId), [projectId]);
  const tasks = useAppSelector(selectProjectTasks);
  const searchQuery = useAppSelector((state) => state.projectsUi.searchQuery);
  const projectSlug = useAppSelector((state) => state.projects.projects[projectId]?.slug);
  const filter = useAppSelector(selectDraftFilter(projectId));
  const sort = useAppSelector(selectDraftSort(projectId));
  const sprints = useAppSelector(selectSprintsForProject(projectId));
  const ctx = useTaskFilterContext(projectId, tasks);

  const personIds = useMemo(
    () => personSortIds(tasks, sort, ctx.fieldsById),
    [tasks, sort, ctx.fieldsById],
  );
  const { subjects: sortSubjects } = useSubjectResolver(personIds);
  const subjectNameById = useMemo(
    () => new Map(sortSubjects.map((subject) => [subject.id, subject.name])),
    [sortSubjects],
  );

  return useMemo(() => {
    let result = includeSubtasks ? tasks.slice() : tasks.filter((t) => !t.parentId);

    if (searchQuery.trim()) {
      result = result.filter((task) => taskMatchesSearch(task, searchQuery, projectSlug));
    }

    result = applyFilters(result, filter, ctx);

    return sortTasks(result, sort, {
      fieldsById: ctx.fieldsById,
      subjectNameById,
      sprints,
      hierarchy: ctx.hierarchy,
      lookup: ctx.lookup,
    });
  }, [
    tasks,
    searchQuery,
    projectSlug,
    filter,
    sort,
    includeSubtasks,
    ctx,
    subjectNameById,
    sprints,
  ]);
}
