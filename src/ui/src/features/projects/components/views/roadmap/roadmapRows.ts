import type { Task } from "@/features/projects/types";
import type { TaskGroup } from "@/features/projects/utils/groupTasks";

export interface RoadmapTaskRow {
  kind: "task";
  /** Unique across groups: a task with two assignees shows once under each. */
  key: string;
  task: Task;
  depth: number;
  hasChildren: boolean;
}

export interface RoadmapGroupRow {
  kind: "group";
  key: string;
  group: TaskGroup;
  collapsed: boolean;
}

export type RoadmapRow = RoadmapTaskRow | RoadmapGroupRow;

/**
 * Flatten tasks into hierarchical row order: each parent immediately followed
 * by its (indented) descendants, respecting the collapsed set. Children whose
 * parent is absent from the set are promoted to roots so nothing is dropped.
 * The same ordered array drives the task list, the bars, and the dependency
 * lines, keeping every row index aligned across the three.
 */
export function buildOrderedRows(
  tasks: Task[],
  collapsedIds: Set<string>,
  keyPrefix = "",
): RoadmapTaskRow[] {
  const present = new Set(tasks.map((t) => t.id));
  const childrenByParent = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId && present.has(t.parentId)) {
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }
  }

  const rows: RoadmapTaskRow[] = [];
  const visit = (task: Task, depth: number) => {
    const kids = childrenByParent.get(task.id) ?? [];
    rows.push({
      kind: "task",
      key: `${keyPrefix}${task.id}`,
      task,
      depth,
      hasChildren: kids.length > 0,
    });
    if (kids.length > 0 && !collapsedIds.has(task.id)) {
      for (const kid of kids) visit(kid, depth + 1);
    }
  };
  for (const t of tasks) {
    if (!t.parentId || !present.has(t.parentId)) visit(t, 0);
  }
  return rows;
}

/** One header row per group, then its tasks nested as `buildOrderedRows` does, unless collapsed. */
export function buildGroupedRows(
  groups: TaskGroup[],
  collapsedIds: Set<string>,
  collapsedGroups: ReadonlySet<string>,
): RoadmapRow[] {
  const rows: RoadmapRow[] = [];
  for (const group of groups) {
    const collapsed = collapsedGroups.has(group.key);
    rows.push({ kind: "group", key: `group:${group.key}`, group, collapsed });
    if (!collapsed) rows.push(...buildOrderedRows(group.tasks, collapsedIds, `${group.key}:`));
  }
  return rows;
}
