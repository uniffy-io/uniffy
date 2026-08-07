import { CheckSquare, Bug, Star, BookOpen, Lightning } from "phosphor-react-native";
import type { IconProps } from "phosphor-react-native";
import type React from "react";

export interface TaskTypeConfig {
  value: string;
  label: string;
  Icon: React.ComponentType<IconProps>;
  description: string;
}

export const TASK_TYPES: TaskTypeConfig[] = [
  { value: "task", label: "Task", Icon: CheckSquare, description: "A standard work item" },
  { value: "bug", label: "Bug", Icon: Bug, description: "A defect or problem to fix" },
  { value: "feature", label: "Feature", Icon: Star, description: "A new capability" },
  { value: "story", label: "Story", Icon: BookOpen, description: "A user story or requirement" },
  { value: "epic", label: "Epic", Icon: Lightning, description: "A large body of work" },
];

const TASK_TYPE_MAP = new Map(TASK_TYPES.map((t) => [t.value, t]));

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
  return label.endsWith("y") ? `${label.slice(0, -1)}ies` : `${label}s`;
}

/** Returns a soft-warning string when the parent/child pairing deviates from convention. */
export function getHierarchyRuleViolation(
  childType: string,
  parentType: string | null,
): string | null {
  const rules = TYPE_CONVENTIONS[childType];
  if (!rules) return null;

  const childLabel = typeLabel(childType);

  if (parentType === null) {
    if (rules.rootOk) return null;
    const expected = rules.allowedParents.map(typeLabel).join(" or ");
    return `${plural(childLabel)} typically belong under a ${expected}.`;
  }

  if (rules.allowedParents.length === 0) {
    return `${plural(childLabel)} are usually top-level.`;
  }
  if (rules.allowedParents.includes(parentType)) return null;

  const expected = rules.allowedParents.map(typeLabel).join(" or ");
  return `Unusual hierarchy: ${childLabel} under ${typeLabel(parentType)}. Typically a ${childLabel} belongs under a ${expected}.`;
}
