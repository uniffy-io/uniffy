import type { SerializedTask } from "@features/projects/projectsSerializer";
import type { TaskFacets } from "@features/projects/viewFacets";

export function todayIso(): string {
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
 * The server applies the whole view filter; the search box and the status and priority facets
 * also apply here, so a tap narrows the list at once while the server result is on its way.
 */
export function narrowTasks(
  tasks: SerializedTask[],
  query: string,
  facets: TaskFacets,
): SerializedTask[] {
  const needle = query.trim().toLowerCase();
  const statuses = facets.ids.status.ids;
  const priorities = facets.ids.priority.ids;
  if (!needle && statuses.length === 0 && priorities.length === 0) return tasks;
  return tasks.filter(
    (task) =>
      (!needle || matchesQuery(task, needle)) &&
      (statuses.length === 0 || statuses.includes(task.status)) &&
      (priorities.length === 0 || priorities.includes(task.priority)),
  );
}
