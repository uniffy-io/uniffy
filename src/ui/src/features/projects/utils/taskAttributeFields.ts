import { TaskPseudoField } from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldDefinition } from "@/features/projects/types";

/**
 * A task attribute the toolbar filters on that is not a project field. `pseudo` is the
 * backend catalog entry a saved view definition carries for the same attribute, so the
 * filter ids here never become a second, web-only catalog. "Root only" and "Depth" share
 * one attribute because a root task is a task at depth 0.
 */
export interface TaskAttributeFilterField {
  readonly id: string;
  readonly name: string;
  readonly valueType: FieldDefinition["type"];
  readonly pseudo: TaskPseudoField;
}

export const TAGS_FILTER_FIELD_ID = "__tags__";
export const HIERARCHY_IN_EPIC_FIELD_ID = "__hierarchy_in_epic__";
export const HIERARCHY_ROOT_ONLY_FIELD_ID = "__hierarchy_root_only__";
export const HIERARCHY_HAS_SUBTASKS_FIELD_ID = "__hierarchy_has_subtasks__";
export const HIERARCHY_DEPTH_FIELD_ID = "__hierarchy_depth__";

export const TASK_ATTRIBUTE_FILTER_FIELDS: readonly TaskAttributeFilterField[] = [
  { id: TAGS_FILTER_FIELD_ID, name: "Tags", valueType: "text", pseudo: TaskPseudoField.TAGS },
  {
    id: HIERARCHY_IN_EPIC_FIELD_ID,
    name: "In Epic",
    valueType: "text",
    pseudo: TaskPseudoField.EPIC,
  },
  {
    id: HIERARCHY_ROOT_ONLY_FIELD_ID,
    name: "Root only",
    valueType: "text",
    pseudo: TaskPseudoField.DEPTH,
  },
  {
    id: HIERARCHY_HAS_SUBTASKS_FIELD_ID,
    name: "Has subtasks",
    valueType: "text",
    pseudo: TaskPseudoField.HAS_SUBTASKS,
  },
  {
    id: HIERARCHY_DEPTH_FIELD_ID,
    name: "Depth",
    valueType: "number",
    pseudo: TaskPseudoField.DEPTH,
  },
];

export function taskAttributeFilterField(id: string): TaskAttributeFilterField | null {
  return TASK_ATTRIBUTE_FILTER_FIELDS.find((attribute) => attribute.id === id) ?? null;
}

/** Field rows so the attributes slot into the condition UI beside the project's own fields. */
export const TASK_ATTRIBUTE_PSEUDO_FIELDS: FieldDefinition[] = TASK_ATTRIBUTE_FILTER_FIELDS.map(
  (attribute) => ({
    id: attribute.id,
    projectId: "",
    name: attribute.name,
    type: attribute.valueType,
    isRequired: false,
    isSystem: true,
    sortOrder: attribute.id === TAGS_FILTER_FIELD_ID ? 999 : 1000,
    config: {},
    createdAt: "",
    updatedAt: "",
  }),
);
