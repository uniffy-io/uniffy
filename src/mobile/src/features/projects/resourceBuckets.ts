import { isTaskOverdue } from "@features/projects/taskFilters";
import type { SerializedTask } from "@features/projects/projectsSerializer";

export const UNASSIGNED = "__unassigned__";

export interface ResourceBucket {
  subjectId: string;
  open: number;
  done: number;
  overdue: number;
  estimated: number;
  spent: number;
}

/**
 * Workload per person over top-level tasks, as the web resource view counts it:
 * a subtask's work is part of its parent's. A task assigned to several people
 * counts once for each of them, so the per-person totals do not sum to the
 * project total. That is deliberate: this answers "how much is on this person",
 * not "how is the project split up".
 */
export function buildResourceBuckets(tasks: readonly SerializedTask[]): ResourceBucket[] {
  const bySubject = new Map<string, ResourceBucket>();

  const bucketFor = (subjectId: string): ResourceBucket => {
    let bucket = bySubject.get(subjectId);
    if (!bucket) {
      bucket = { subjectId, open: 0, done: 0, overdue: 0, estimated: 0, spent: 0 };
      bySubject.set(subjectId, bucket);
    }
    return bucket;
  };

  for (const task of tasks) {
    if (task.parentId) continue;
    const owners = task.assigneeIds.length > 0 ? task.assigneeIds : [UNASSIGNED];
    for (const subjectId of owners) {
      const bucket = bucketFor(subjectId);
      if (task.completedAt) bucket.done += 1;
      else bucket.open += 1;
      if (isTaskOverdue(task.dueDate, task.completedAt)) bucket.overdue += 1;
      bucket.estimated += task.estimatedMinutes ?? 0;
      bucket.spent += task.timeSpentMinutes ?? 0;
    }
  }

  // Busiest first; unassigned always sinks to the bottom.
  return [...bySubject.values()].sort((a, b) => {
    if (a.subjectId === UNASSIGNED) return 1;
    if (b.subjectId === UNASSIGNED) return -1;
    return b.open - a.open || b.overdue - a.overdue;
  });
}
