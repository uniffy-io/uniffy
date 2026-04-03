import {
  CheckSquare,
  Bug,
  Star,
  BookOpen,
  Lightning,
  type Icon,
} from "@phosphor-icons/react";

export interface TaskTypeConfig {
  value: string;
  label: string;
  icon: Icon;
  description: string;
}

export const TASK_TYPES: TaskTypeConfig[] = [
  {
    value: "task",
    label: "Task",
    icon: CheckSquare,
    description: "A standard work item",
  },
  {
    value: "bug",
    label: "Bug",
    icon: Bug,
    description: "A defect or problem to fix",
  },
  {
    value: "feature",
    label: "Feature",
    icon: Star,
    description: "A new capability or enhancement",
  },
  {
    value: "story",
    label: "Story",
    icon: BookOpen,
    description: "A user story or requirement",
  },
  {
    value: "epic",
    label: "Epic",
    icon: Lightning,
    description: "A large body of work",
  },
];

export const TASK_TYPE_MAP = new Map(
  TASK_TYPES.map((t) => [t.value, t])
);

export function getTaskTypeConfig(value: string): TaskTypeConfig {
  return TASK_TYPE_MAP.get(value) ?? TASK_TYPES[0];
}

/**
 * Determine which custom fields are visible and required for a given task type.
 * System fields are excluded - they are always visible.
 * If no schema exists for the type, all custom fields are shown with none required.
 */
export function getFieldsForTaskType(
  fields: Array<{ id: string; isSystem: boolean }>,
  taskType: string,
  typeFieldSchemas: Record<string, { shownFieldIds: string[]; requiredFieldIds: string[] }>,
): { visibleFieldIds: Set<string>; requiredFieldIds: Set<string> } {
  const schema = typeFieldSchemas[taskType];
  const customFields = fields.filter((f) => !f.isSystem);

  if (!schema || schema.shownFieldIds.length === 0) {
    // No schema = show all custom fields, none required
    return {
      visibleFieldIds: new Set(customFields.map((f) => f.id)),
      requiredFieldIds: new Set<string>(),
    };
  }

  return {
    visibleFieldIds: new Set(schema.shownFieldIds),
    requiredFieldIds: new Set(schema.requiredFieldIds),
  };
}
