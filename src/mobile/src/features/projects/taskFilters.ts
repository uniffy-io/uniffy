import type { SerializedTask } from "@features/projects/projectsSerializer";

export interface TaskFilters {
  statusIds: string[];
  priorityIds: string[];
  assigneeIds: string[];
  tagIds: string[];
  overdueOnly: boolean;
}

export const NO_TASK_FILTERS: TaskFilters = {
  statusIds: [],
  priorityIds: [],
  assigneeIds: [],
  tagIds: [],
  overdueOnly: false,
};

export function activeFilterCount(filters: TaskFilters): number {
  return (
    filters.statusIds.length +
    filters.priorityIds.length +
    filters.assigneeIds.length +
    filters.tagIds.length +
    (filters.overdueOnly ? 1 : 0)
  );
}

export function isNarrowed(filters: TaskFilters, query: string): boolean {
  return query.trim().length > 0 || activeFilterCount(filters) > 0;
}

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Due dates are plain `YYYY-MM-DD`, which orders correctly as a string. Parsing
 * them into a `Date` would read them as UTC midnight and mark a task due today
 * as overdue for anyone east of Greenwich.
 */
export function isTaskOverdue(dueDate: string | null, completedAt?: string): boolean {
  if (!dueDate || completedAt) return false;
  return dueDate < todayIso();
}

function matchesQuery(task: SerializedTask, needle: string): boolean {
  return (
    task.title.toLowerCase().includes(needle) ||
    task.description.toLowerCase().includes(needle) ||
    `#${task.number}`.includes(needle)
  );
}

/**
 * Selections within one facet are OR-ed, and the facets are AND-ed together -
 * picking two statuses widens, adding an assignee narrows.
 */
export function filterTasks(
  tasks: SerializedTask[],
  filters: TaskFilters,
  query: string,
): SerializedTask[] {
  const needle = query.trim().toLowerCase();

  return tasks.filter((task) => {
    if (needle && !matchesQuery(task, needle)) return false;
    if (filters.statusIds.length > 0 && !filters.statusIds.includes(task.status)) return false;
    if (filters.priorityIds.length > 0 && !filters.priorityIds.includes(task.priority))
      return false;
    if (
      filters.assigneeIds.length > 0 &&
      !task.assigneeIds.some((id) => filters.assigneeIds.includes(id))
    ) {
      return false;
    }
    if (filters.tagIds.length > 0 && !task.tags.some((t) => filters.tagIds.includes(t.id))) {
      return false;
    }
    if (filters.overdueOnly && !isTaskOverdue(task.dueDate, task.completedAt)) return false;
    return true;
  });
}
