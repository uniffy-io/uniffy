/**
 * Filter evaluation utility for tasks
 *
 * Evaluates FilterConfig conditions against tasks with AND/OR logic.
 */

import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task } from "@/features/projects/types";
import type { FilterConfig, FilterCondition } from "@/features/projects/types/views";

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

/**
 * Evaluate a single filter condition against a task
 */
function evaluateCondition(task: Task, condition: FilterCondition): boolean {
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
 * Apply a FilterConfig (with AND/OR logic) to a list of tasks
 */
export function applyFilters(tasks: Task[], filterConfig: FilterConfig | null): Task[] {
  if (!filterConfig || filterConfig.conditions.length === 0) return tasks;

  return tasks.filter((task) => {
    const results = filterConfig.conditions.map((c) => evaluateCondition(task, c));
    if (filterConfig.logic === "and") return results.every(Boolean);
    return results.some(Boolean);
  });
}
