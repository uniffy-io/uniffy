import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task } from "@/features/projects/types/project";

/** Raw value of a system or custom field; Assignee is the full id array. */
export function getTaskFieldValue(task: Task, fieldId: string): unknown {
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

/** Person and tag values arrive as an id array or, for single-value fields, a bare id. */
export function toIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return typeof value === "string" && value.length > 0 ? [value] : [];
}
