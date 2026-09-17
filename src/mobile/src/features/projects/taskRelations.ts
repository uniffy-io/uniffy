import type { SerializedTask } from "@features/projects/projectsSerializer";

export interface SubtaskCount {
  total: number;
  done: number;
}

/** Built once per task list, so rows and cards never scan the list for their relatives. */
export interface TaskRelations {
  byId: Map<string, SerializedTask>;
  /** Direct children, in board order. */
  childrenByParent: Map<string, SerializedTask[]>;
  subtaskCounts: Map<string, SubtaskCount>;
}

function byBoardOrder(a: SerializedTask, b: SerializedTask): number {
  return a.sortOrder - b.sortOrder || a.number - b.number;
}

export function buildTaskRelations(tasks: readonly SerializedTask[]): TaskRelations {
  const byId = new Map<string, SerializedTask>();
  const childrenByParent = new Map<string, SerializedTask[]>();
  const subtaskCounts = new Map<string, SubtaskCount>();
  for (const task of tasks) {
    byId.set(task.id, task);
    if (!task.parentId) continue;
    const siblings = childrenByParent.get(task.parentId);
    if (siblings) siblings.push(task);
    else childrenByParent.set(task.parentId, [task]);
    const count = subtaskCounts.get(task.parentId) ?? { total: 0, done: 0 };
    count.total += 1;
    if (task.completedAt) count.done += 1;
    subtaskCounts.set(task.parentId, count);
  }
  for (const children of childrenByParent.values()) children.sort(byBoardOrder);
  return { byId, childrenByParent, subtaskCounts };
}

/**
 * Blockers that are loaded and still open. An id missing from the loaded set is unknown, not
 * open: the server ignores it too, and treating it as open would mark a free task blocked with
 * nothing on screen to explain it.
 */
export function openBlockerCount(
  task: SerializedTask,
  byId: ReadonlyMap<string, SerializedTask>,
): number {
  if (task.completedAt) return 0;
  let open = 0;
  for (const id of task.blockedByTaskIds) {
    const blocker = byId.get(id);
    if (blocker && !blocker.completedAt) open += 1;
  }
  return open;
}

export function isTaskBlocked(
  task: SerializedTask,
  byId: ReadonlyMap<string, SerializedTask>,
): boolean {
  return openBlockerCount(task, byId) > 0;
}

/** `SLUG-12` for the parent, or null when there is none or it is not loaded. */
export function parentKeyOf(
  task: SerializedTask,
  byId: ReadonlyMap<string, SerializedTask>,
  projectSlug: string,
): string | null {
  if (!task.parentId) return null;
  const parent = byId.get(task.parentId);
  return parent ? `${projectSlug}-${parent.number}` : null;
}
