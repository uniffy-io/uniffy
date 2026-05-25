/**
 * Filter evaluation utility for tasks
 *
 * Evaluates FilterConfig conditions against tasks with AND/OR logic.
 */

import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task } from "@/features/projects/types";
import type { FilterConfig, FilterCondition } from "@/features/projects/types/views";

export const TAGS_FILTER_FIELD_ID = "__tags__";

export const HIERARCHY_IN_EPIC_FIELD_ID = "__hierarchy_in_epic__";
export const HIERARCHY_ROOT_ONLY_FIELD_ID = "__hierarchy_root_only__";
export const HIERARCHY_HAS_SUBTASKS_FIELD_ID = "__hierarchy_has_subtasks__";
export const HIERARCHY_DEPTH_FIELD_ID = "__hierarchy_depth__";

const HIERARCHY_FIELD_IDS = new Set([
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_DEPTH_FIELD_ID,
]);

export interface TaskHierarchyIndex {
  /** task id -> depth in tree (0 for root) */
  depthById: Map<string, number>;
  /** task id -> set of ancestor task ids (excluding self) */
  ancestorIdsById: Map<string, Set<string>>;
  /** set of task ids that have at least one direct child */
  hasChildren: Set<string>;
}

/**
 * Pre-compute per-task ancestry data once per filter pass.
 *
 * The depth is the number of ancestors above the task (0 for root).
 * Cycles in ``parent_id`` are tolerated: each chain stops at the depth limit
 * or when a repeat is detected, so a malformed dataset cannot loop forever.
 */
export function buildTaskHierarchyIndex(tasks: Task[]): TaskHierarchyIndex {
  const parentById = new Map<string, string | null>();
  const hasChildren = new Set<string>();
  for (const t of tasks) {
    parentById.set(t.id, t.parentId ?? null);
    if (t.parentId) hasChildren.add(t.parentId);
  }

  const depthById = new Map<string, number>();
  const ancestorIdsById = new Map<string, Set<string>>();
  const MAX_DEPTH = 64;

  for (const t of tasks) {
    const ancestors = new Set<string>();
    let depth = 0;
    let currentParent = t.parentId ?? null;
    while (currentParent && depth < MAX_DEPTH && !ancestors.has(currentParent)) {
      ancestors.add(currentParent);
      depth += 1;
      currentParent = parentById.get(currentParent) ?? null;
    }
    depthById.set(t.id, depth);
    ancestorIdsById.set(t.id, ancestors);
  }

  return { depthById, ancestorIdsById, hasChildren };
}

function evaluateHierarchyCondition(
  task: Task,
  condition: FilterCondition,
  index: TaskHierarchyIndex,
): boolean {
  if (condition.fieldId === HIERARCHY_ROOT_ONLY_FIELD_ID) {
    const root = task.parentId === null || task.parentId === undefined;
    return condition.operator === "is_empty" ? root : !root;
  }
  if (condition.fieldId === HIERARCHY_HAS_SUBTASKS_FIELD_ID) {
    const hasKids = index.hasChildren.has(task.id);
    return condition.operator === "is_not_empty" ? hasKids : !hasKids;
  }
  if (condition.fieldId === HIERARCHY_IN_EPIC_FIELD_ID) {
    const epicId = condition.value ? String(condition.value) : "";
    if (condition.operator === "is_empty") {
      return (index.ancestorIdsById.get(task.id)?.size ?? 0) === 0;
    }
    if (condition.operator === "is_not_empty") {
      return (index.ancestorIdsById.get(task.id)?.size ?? 0) > 0;
    }
    if (!epicId) return true;
    const inEpic = task.id === epicId || (index.ancestorIdsById.get(task.id)?.has(epicId) ?? false);
    return condition.operator === "equals" ? inEpic : !inEpic;
  }
  if (condition.fieldId === HIERARCHY_DEPTH_FIELD_ID) {
    const depth = index.depthById.get(task.id) ?? 0;
    if (condition.operator === "is_empty") return depth === 0;
    if (condition.operator === "is_not_empty") return depth > 0;
    if (condition.operator === "equals") return depth === Number(condition.value);
    if (condition.operator === "not_equals") return depth !== Number(condition.value);
    if (condition.operator === "greater_than") return depth > Number(condition.value);
    if (condition.operator === "less_than") return depth < Number(condition.value);
    if (condition.operator === "between") {
      if (!Array.isArray(condition.value) || condition.value.length < 2) return true;
      const min = Number(condition.value[0]);
      const max = Number(condition.value[1]);
      return depth >= min && depth <= max;
    }
  }
  return true;
}

/**
 * Get a field value from a task for filter evaluation
 */
function getFieldValue(task: Task, fieldId: string): unknown {
  switch (fieldId) {
    case SYSTEM_FIELD_IDS.TITLE:
      return task.title;
    case SYSTEM_FIELD_IDS.STATUS:
      return task.status;
    case SYSTEM_FIELD_IDS.PRIORITY:
      return task.priority;
    case SYSTEM_FIELD_IDS.ASSIGNEE:
      return task.assigneeIds;
    case SYSTEM_FIELD_IDS.START_DATE:
      return task.startDate;
    case SYSTEM_FIELD_IDS.DUE_DATE:
      return task.dueDate;
    default:
      return task.fieldValues[fieldId];
  }
}

function evaluateTagCondition(task: Task, condition: FilterCondition): boolean {
  const taskTagSet = new Set(task.tagIds ?? []);
  const raw = condition.value;
  const tagIds: string[] = Array.isArray(raw)
    ? (raw as string[])
    : raw
      ? [String(raw)]
      : [];
  if (tagIds.length === 0 && condition.operator !== "is_empty" && condition.operator !== "is_not_empty") {
    return true;
  }
  switch (condition.operator) {
    case "equals":
      // is (single) - task must carry every selected tag (ALL).
      return tagIds.every((id) => taskTagSet.has(id));
    case "not_equals":
      // is not (single) - task must carry none of the selected tags (NONE).
      return tagIds.every((id) => !taskTagSet.has(id));
    case "contains":
      // is one of - task must carry at least one of the selected tags (ANY).
      return tagIds.some((id) => taskTagSet.has(id));
    case "not_contains":
      // is none of - task must carry none of the selected tags (NONE).
      return tagIds.every((id) => !taskTagSet.has(id));
    case "is_empty":
      return taskTagSet.size === 0;
    case "is_not_empty":
      return taskTagSet.size > 0;
    default:
      return true;
  }
}

/**
 * Evaluate a single filter condition against a task
 */
function evaluateCondition(
  task: Task,
  condition: FilterCondition,
  hierarchyIndex?: TaskHierarchyIndex,
): boolean {
  if (condition.fieldId === TAGS_FILTER_FIELD_ID) {
    return evaluateTagCondition(task, condition);
  }
  if (HIERARCHY_FIELD_IDS.has(condition.fieldId) && hierarchyIndex) {
    return evaluateHierarchyCondition(task, condition, hierarchyIndex);
  }
  const value = getFieldValue(task, condition.fieldId);

  switch (condition.operator) {
    case "is_empty":
      return (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );

    case "is_not_empty":
      return (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0)
      );

    case "equals":
      if (Array.isArray(value)) return value.includes(condition.value as string);
      return String(value) === String(condition.value);

    case "not_equals":
      if (Array.isArray(value)) return !value.includes(condition.value as string);
      return String(value) !== String(condition.value);

    case "contains":
      return String(value ?? "")
        .toLowerCase()
        .includes(String(condition.value ?? "").toLowerCase());

    case "not_contains":
      return !String(value ?? "")
        .toLowerCase()
        .includes(String(condition.value ?? "").toLowerCase());

    case "greater_than":
      return (value ?? "") > (condition.value ?? "");

    case "less_than":
      return (value ?? "") < (condition.value ?? "");

    case "between": {
      if (!Array.isArray(condition.value) || condition.value.length < 2) return true;
      const [min, max] = condition.value;
      return (value ?? "") >= min && (value ?? "") <= max;
    }

    default:
      return true;
  }
}

/**
 * Apply a FilterConfig (with AND/OR logic) to a list of tasks.
 *
 * Pass ``hierarchyIndex`` (precomputed from the full task list) when the
 * filter may contain hierarchy pseudo-fields. Without it those conditions
 * pass-through unchanged.
 */
export function applyFilters(
  tasks: Task[],
  filterConfig: FilterConfig | null,
  hierarchyIndex?: TaskHierarchyIndex,
): Task[] {
  if (!filterConfig || filterConfig.conditions.length === 0) return tasks;

  return tasks.filter((task) => {
    const results = filterConfig.conditions.map((c) =>
      evaluateCondition(task, c, hierarchyIndex),
    );
    if (filterConfig.logic === "and") return results.every(Boolean);
    return results.some(Boolean);
  });
}
