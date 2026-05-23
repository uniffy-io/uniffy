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
 * Conventional parent expectations per task type. These drive soft warnings
 * (never blocks) when a user creates a hierarchy that diverges from the
 * Jira/Linear conventions. `rootOk` means a parent is optional. `allowedParents`
 * is the set of conventional parent types when one is present.
 */
const TYPE_CONVENTIONS: Record<string, { rootOk: boolean; allowedParents: string[] }> = {
  epic: { rootOk: true, allowedParents: [] },
  story: { rootOk: false, allowedParents: ["epic"] },
  feature: { rootOk: false, allowedParents: ["epic"] },
  task: { rootOk: true, allowedParents: ["story", "feature"] },
  bug: { rootOk: true, allowedParents: ["story", "feature"] },
};

function typeLabel(type: string): string {
  return getTaskTypeConfig(type).label;
}

function plural(label: string): string {
  if (label.endsWith("y")) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

/**
 * Returns a human-readable warning when the (childType, parentType) pairing
 * deviates from the conventional hierarchy, or null when the pairing is fine.
 * Parent of `null` means the task is being placed at the root.
 */
export function getHierarchyRuleViolation(
  childType: string,
  parentType: string | null,
): string | null {
  const rules = TYPE_CONVENTIONS[childType];
  if (!rules) return null;

  const childLabel = typeLabel(childType);

  if (parentType === null || parentType === undefined) {
    if (rules.rootOk) return null;
    const expected = rules.allowedParents.map((t) => typeLabel(t)).join(" or ");
    return `${plural(childLabel)} typically belong under a ${expected}.`;
  }

  if (rules.allowedParents.length === 0) {
    return `${plural(childLabel)} are usually top-level.`;
  }
  if (rules.allowedParents.includes(parentType)) return null;

  const parentLabel = typeLabel(parentType);
  const expected = rules.allowedParents.map((t) => typeLabel(t)).join(" or ");
  return `Unusual hierarchy: ${childLabel} under ${parentLabel}. Typically a ${childLabel} belongs under a ${expected}.`;
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
