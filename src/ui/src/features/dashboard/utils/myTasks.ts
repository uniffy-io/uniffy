import { calendarDayKey } from "@/shared/utils/dateFormatting";
import type { Task } from "@/features/projects/types/project";

export interface MyTaskGroups {
  overdue: Task[];
  dueToday: Task[];
  /** Due after today first, then undated tasks. */
  upcoming: Task[];
}

function byTitle(a: Task, b: Task): number {
  return (a.title ?? "").localeCompare(b.title ?? "");
}

/**
 * Open tasks assigned to `userId`, bucketed against `todayKey` (the effective zone's `YYYY-MM-DD`).
 * Due dates compare as calendar days, so a task due today is never overdue in any zone.
 */
export function categorizeMyTasks(
  tasks: Iterable<Task>,
  userId: string,
  todayKey: string,
): MyTaskGroups {
  const overdue: { task: Task; due: string }[] = [];
  const dueToday: Task[] = [];
  const upcomingDated: { task: Task; due: string }[] = [];
  const undated: Task[] = [];

  for (const task of tasks) {
    if (task.deletedAt || task.completedAt) continue;
    if (!task.assigneeIds.includes(userId)) continue;
    if (!task.dueDate) {
      undated.push(task);
      continue;
    }
    const due = calendarDayKey(task.dueDate);
    if (due < todayKey) overdue.push({ task, due });
    else if (due === todayKey) dueToday.push(task);
    else upcomingDated.push({ task, due });
  }

  const byDue = (a: { task: Task; due: string }, b: { task: Task; due: string }) =>
    a.due.localeCompare(b.due) || byTitle(a.task, b.task);

  return {
    overdue: overdue.sort(byDue).map((entry) => entry.task),
    dueToday: dueToday.sort(byTitle),
    upcoming: [
      ...upcomingDated.sort(byDue).map((entry) => entry.task),
      ...undated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ],
  };
}
