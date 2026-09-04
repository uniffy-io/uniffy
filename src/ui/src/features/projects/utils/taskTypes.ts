import { Bug, BookOpen, CheckCircle, Diamond, Sparkle, type Icon } from "@phosphor-icons/react";

export interface TaskTypeConfig {
  value: string;
  label: string;
  icon: Icon;
  description: string;
}

// Glyphs stay out of the project icon set so one shape means one thing app-wide, and
// none of them is a square: the table draws a real checkbox two columns to the left.
export const TASK_TYPES: TaskTypeConfig[] = [
  {
    value: "task",
    label: "Task",
    icon: CheckCircle,
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
    icon: Sparkle,
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
    icon: Diamond,
    description: "A large body of work",
  },
];

export const TASK_TYPE_MAP = new Map(TASK_TYPES.map((t) => [t.value, t]));

export function getTaskTypeConfig(value: string): TaskTypeConfig {
  return TASK_TYPE_MAP.get(value) ?? TASK_TYPES[0];
}

/** Soft-warning rules; never block. `rootOk` lets a type sit at the top level. */
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

/** Returns a soft-warning string when the parent/child pairing deviates from convention. */
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

/** System fields are always visible; this returns only the custom-field subset. */
export function getFieldsForTaskType(
  fields: Array<{ id: string; isSystem: boolean }>,
  taskType: string,
  typeFieldSchemas: Record<string, { shownFieldIds: string[]; requiredFieldIds: string[] }>,
): { visibleFieldIds: Set<string>; requiredFieldIds: Set<string> } {
  const schema = typeFieldSchemas[taskType];
  const customFields = fields.filter((f) => !f.isSystem);

  if (!schema || schema.shownFieldIds.length === 0) {
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
