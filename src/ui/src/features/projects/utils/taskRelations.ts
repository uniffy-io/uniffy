import type { Task } from "@/features/projects/types/project";

export type TaskLookup = (id: string) => Task | undefined;

/**
 * Blockers that are loaded and still open. An id missing from the loaded set is ignored, as the
 * server does when it enforces blockers: it is almost always a deleted task.
 */
export function openBlockerCount(task: Task, lookup: TaskLookup): number {
  if (task.completedAt) return 0;
  let open = 0;
  for (const id of task.blockedByTaskIds) {
    const blocker = lookup(id);
    if (blocker && !blocker.completedAt) open += 1;
  }
  return open;
}

export function isTaskBlocked(task: Task, lookup: TaskLookup): boolean {
  return openBlockerCount(task, lookup) > 0;
}
