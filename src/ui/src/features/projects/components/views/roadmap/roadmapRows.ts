import type { Task } from "@/features/projects/types";

export interface RoadmapRow {
  task: Task;
  depth: number;
  hasChildren: boolean;
}

/**
 * Flatten tasks into hierarchical row order: each parent immediately followed
 * by its (indented) descendants, respecting the collapsed set. Children whose
 * parent is absent from the set are promoted to roots so nothing is dropped.
 * The same ordered array drives the task list, the bars, and the dependency
 * lines, keeping every row index aligned across the three.
 */
export function buildOrderedRows(tasks: Task[], collapsedIds: Set<string>): RoadmapRow[] {
  const present = new Set(tasks.map((t) => t.id));
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId && present.has(t.parentId)) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }

  const rows: RoadmapRow[] = [];
  const visit = (task: Task, depth: number) => {
    const kids = childrenByParent.get(task.id) ?? [];
    rows.push({ task, depth, hasChildren: kids.length > 0 });
    if (kids.length > 0 && !collapsedIds.has(task.id)) {
      for (const kid of kids) visit(kid, depth + 1);
    }
  };
  for (const t of tasks) {
    if (!t.parentId || !present.has(t.parentId)) visit(t, 0);
  }
  return rows;
}
