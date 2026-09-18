import type { Task } from "@/features/projects/types";
import type { FilterConfig, FilterCondition } from "@/features/projects/types/views";
import {
  HIERARCHY_DEPTH_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  TAGS_FILTER_FIELD_ID,
} from "@/features/projects/utils/taskAttributeFields";
import { getTaskFieldValue, toIdList } from "@/features/projects/utils/taskFieldValue";

const HIERARCHY_FIELD_IDS = new Set([
  HIERARCHY_IN_EPIC_FIELD_ID,
  HIERARCHY_ROOT_ONLY_FIELD_ID,
  HIERARCHY_HAS_SUBTASKS_FIELD_ID,
  HIERARCHY_DEPTH_FIELD_ID,
]);

export interface TaskHierarchyIndex {
  depthById: Map<string, number>;
  ancestorIdsById: Map<string, Set<string>>;
  hasChildren: Set<string>;
}

/** Cycles in parent_id are tolerated: each chain stops at MAX_DEPTH or on repeat. */
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

function isIncompleteValue(value: FilterCondition["value"]): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A list condition value (people, multi-picked ids) matches when the task holds any of them. */
function matchesAnyId(taskValue: unknown, wanted: string[]): boolean {
  const have = toIdList(taskValue);
  return wanted.some((id) => have.includes(id));
}

function evaluateTagCondition(task: Task, condition: FilterCondition): boolean {
  const taskTagSet = new Set(task.tagIds ?? []);
  const tagIds = toIdList(condition.value);
  if (
    tagIds.length === 0 &&
    condition.operator !== "is_empty" &&
    condition.operator !== "is_not_empty"
  ) {
    return true;
  }
  // Operator semantics: equals=ALL, not_equals=NONE, contains=ANY, not_contains=NONE.
  switch (condition.operator) {
    case "equals":
      return tagIds.every((id) => taskTagSet.has(id));
    case "not_equals":
      return tagIds.every((id) => !taskTagSet.has(id));
    case "contains":
      return tagIds.some((id) => taskTagSet.has(id));
    case "not_contains":
      return tagIds.every((id) => !taskTagSet.has(id));
    case "is_empty":
      return taskTagSet.size === 0;
    case "is_not_empty":
      return taskTagSet.size > 0;
    default:
      return true;
  }
}

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
  const value = getTaskFieldValue(task, condition.fieldId);

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
      if (isIncompleteValue(condition.value)) return true;
      if (Array.isArray(condition.value)) return matchesAnyId(value, toIdList(condition.value));
      if (Array.isArray(value)) return value.includes(condition.value as string);
      return String(value) === String(condition.value);

    case "not_equals":
      if (isIncompleteValue(condition.value)) return true;
      if (Array.isArray(condition.value)) return !matchesAnyId(value, toIdList(condition.value));
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

/** Pass hierarchyIndex when conditions reference hierarchy pseudo-fields; else they no-op. */
export function applyFilters(
  tasks: Task[],
  filterConfig: FilterConfig | null,
  hierarchyIndex?: TaskHierarchyIndex,
): Task[] {
  if (!filterConfig || filterConfig.conditions.length === 0) return tasks;

  return tasks.filter((task) => {
    const results = filterConfig.conditions.map((c) => evaluateCondition(task, c, hierarchyIndex));
    if (filterConfig.logic === "and") return results.every(Boolean);
    return results.some(Boolean);
  });
}
