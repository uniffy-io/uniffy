import {
  SortDirection,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldDefinition, FieldType } from "@/features/projects/types/fields";
import type { ViewFieldRef } from "@/features/projects/types/views";

/**
 * Web mirror of the backend view catalog (`domains/projects/views/catalog.py`): which operators,
 * sorts and groupings each kind of field supports. It shapes what the UI offers; the backend
 * validator stays the gate, so a drift here surfaces as a refused save, never as a wider filter.
 */
export type FieldKind =
  | "text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "timestamp"
  | "person"
  | "single_person"
  | "tags"
  | "sprint"
  | "task_type"
  | "task_ref"
  | "task_ref_set"
  | "epic"
  | "boolean"
  | "reference";

export type IdFlag = "includeCurrentUser" | "includeEmpty" | "includeActiveSprint";

const FIELD_TYPE_KINDS: Record<FieldType, FieldKind> = {
  text: "text",
  number: "number",
  single_select: "single_select",
  multi_select: "multi_select",
  date: "date",
  person: "person",
  reference: "reference",
};

const PSEUDO_FIELD_KINDS: ReadonlyMap<Pseudo, FieldKind> = new Map([
  [Pseudo.TAGS, "tags"],
  [Pseudo.SPRINT, "sprint"],
  [Pseudo.TASK_TYPE, "task_type"],
  [Pseudo.CREATOR, "single_person"],
  [Pseudo.PARENT, "task_ref"],
  [Pseudo.EPIC, "epic"],
  [Pseudo.HAS_SUBTASKS, "boolean"],
  [Pseudo.DEPTH, "number"],
  [Pseudo.IS_MILESTONE, "boolean"],
  [Pseudo.IS_BLOCKED, "boolean"],
  [Pseudo.BLOCKED_BY, "task_ref_set"],
  [Pseudo.CREATED_AT, "timestamp"],
  [Pseudo.UPDATED_AT, "timestamp"],
  [Pseudo.COMPLETED_AT, "timestamp"],
  [Pseudo.ESTIMATED_MINUTES, "number"],
  [Pseudo.TIME_SPENT_MINUTES, "number"],
  [Pseudo.NUMBER, "number"],
]);

export const PSEUDO_FIELD_LABELS: ReadonlyMap<Pseudo, string> = new Map([
  [Pseudo.TAGS, "Tags"],
  [Pseudo.SPRINT, "Sprint"],
  [Pseudo.TASK_TYPE, "Type"],
  [Pseudo.CREATOR, "Creator"],
  [Pseudo.PARENT, "Parent"],
  [Pseudo.EPIC, "Epic"],
  [Pseudo.HAS_SUBTASKS, "Has subtasks"],
  [Pseudo.DEPTH, "Depth"],
  [Pseudo.IS_MILESTONE, "Milestone"],
  [Pseudo.IS_BLOCKED, "Blocked"],
  [Pseudo.BLOCKED_BY, "Blocked by"],
  [Pseudo.CREATED_AT, "Created"],
  [Pseudo.UPDATED_AT, "Updated"],
  [Pseudo.COMPLETED_AT, "Completed"],
  [Pseudo.ESTIMATED_MINUTES, "Estimate (min)"],
  [Pseudo.TIME_SPENT_MINUTES, "Time spent (min)"],
  [Pseudo.NUMBER, "ID"],
]);

/** Task attributes the filter builder offers, in menu order. */
export const FILTERABLE_PSEUDO_FIELDS: readonly Pseudo[] = [
  Pseudo.TASK_TYPE,
  Pseudo.SPRINT,
  Pseudo.TAGS,
  Pseudo.EPIC,
  Pseudo.PARENT,
  Pseudo.CREATOR,
  Pseudo.IS_BLOCKED,
  Pseudo.BLOCKED_BY,
  Pseudo.IS_MILESTONE,
  Pseudo.HAS_SUBTASKS,
  Pseudo.DEPTH,
  Pseudo.CREATED_AT,
  Pseudo.UPDATED_AT,
  Pseudo.COMPLETED_AT,
  Pseudo.ESTIMATED_MINUTES,
  Pseudo.TIME_SPENT_MINUTES,
  Pseudo.NUMBER,
];

const NEVER_EMPTY_PSEUDO_FIELDS: ReadonlySet<Pseudo> = new Set([
  Pseudo.TASK_TYPE,
  Pseudo.CREATOR,
  Pseudo.DEPTH,
  Pseudo.CREATED_AT,
  Pseudo.UPDATED_AT,
  Pseudo.NUMBER,
]);

const EMPTINESS: readonly Op[] = [Op.IS_EMPTY, Op.IS_NOT_EMPTY];
const SINGLE_ID_SET: readonly Op[] = [Op.IS, Op.IS_NOT, Op.IS_ANY_OF, Op.IS_NONE_OF, ...EMPTINESS];
const MULTI_ID_SET: readonly Op[] = [Op.IS_ANY_OF, Op.IS_ALL_OF, Op.IS_NONE_OF, ...EMPTINESS];
const DATE_SET: readonly Op[] = [
  Op.IS,
  Op.BEFORE,
  Op.AFTER,
  Op.ON_OR_BEFORE,
  Op.ON_OR_AFTER,
  Op.BETWEEN,
  ...EMPTINESS,
];

const OPERATORS: Record<FieldKind, readonly Op[]> = {
  text: [Op.CONTAINS, Op.NOT_CONTAINS, Op.IS, Op.IS_NOT, ...EMPTINESS],
  number: [Op.IS, Op.IS_NOT, Op.GREATER_THAN, Op.LESS_THAN, Op.BETWEEN, ...EMPTINESS],
  single_select: SINGLE_ID_SET,
  task_type: SINGLE_ID_SET,
  sprint: SINGLE_ID_SET,
  task_ref: SINGLE_ID_SET,
  epic: SINGLE_ID_SET,
  single_person: SINGLE_ID_SET,
  multi_select: MULTI_ID_SET,
  tags: MULTI_ID_SET,
  task_ref_set: MULTI_ID_SET,
  person: [Op.IS_ANY_OF, Op.IS_ALL_OF, Op.IS_NONE_OF, Op.IS, Op.IS_NOT, ...EMPTINESS],
  date: DATE_SET,
  timestamp: DATE_SET,
  boolean: [Op.IS],
  reference: EMPTINESS,
};

export const ID_KINDS: ReadonlySet<FieldKind> = new Set([
  "single_select",
  "multi_select",
  "person",
  "single_person",
  "tags",
  "sprint",
  "task_type",
  "task_ref",
  "task_ref_set",
  "epic",
]);

export const ID_FLAGS: Readonly<Partial<Record<FieldKind, readonly IdFlag[]>>> = {
  single_select: ["includeEmpty"],
  multi_select: ["includeEmpty"],
  person: ["includeCurrentUser", "includeEmpty"],
  single_person: ["includeCurrentUser"],
  tags: ["includeEmpty"],
  sprint: ["includeActiveSprint", "includeEmpty"],
  task_ref: ["includeEmpty"],
  task_ref_set: ["includeEmpty"],
  epic: ["includeEmpty"],
};

const SORTABLE_KINDS: ReadonlySet<FieldKind> = new Set([
  "text",
  "number",
  "single_select",
  "date",
  "timestamp",
  "person",
  "single_person",
  "sprint",
  "task_type",
  "boolean",
]);

const GROUPABLE_KINDS: ReadonlySet<FieldKind> = new Set([
  "single_select",
  "multi_select",
  "person",
  "single_person",
  "tags",
  "sprint",
  "task_type",
  "date",
  "timestamp",
  "boolean",
  "epic",
]);

export const SINGLE_ID_OPERATORS: ReadonlySet<Op> = new Set([Op.IS, Op.IS_NOT]);
export const EMPTINESS_OPERATORS: ReadonlySet<Op> = new Set(EMPTINESS);

export const OPERATOR_LABELS: ReadonlyMap<Op, string> = new Map([
  [Op.IS, "is"],
  [Op.IS_NOT, "is not"],
  [Op.IS_ANY_OF, "is any of"],
  [Op.IS_NONE_OF, "is none of"],
  [Op.IS_ALL_OF, "is all of"],
  [Op.CONTAINS, "contains"],
  [Op.NOT_CONTAINS, "does not contain"],
  [Op.IS_EMPTY, "is empty"],
  [Op.IS_NOT_EMPTY, "is not empty"],
  [Op.GREATER_THAN, "greater than"],
  [Op.LESS_THAN, "less than"],
  [Op.BETWEEN, "between"],
  [Op.BEFORE, "before"],
  [Op.AFTER, "after"],
  [Op.ON_OR_BEFORE, "on or before"],
  [Op.ON_OR_AFTER, "on or after"],
]);

export function fieldRef(fieldId: string): ViewFieldRef {
  return { kind: "field", fieldId };
}

export function pseudoRef(pseudo: Pseudo): ViewFieldRef {
  return { kind: "pseudo", pseudo };
}

/** Stable string form of a ref, for map keys and select values. */
export function fieldRefKey(ref: ViewFieldRef): string {
  return ref.kind === "field" ? `field:${ref.fieldId}` : `pseudo:${ref.pseudo}`;
}

export function fieldRefFromKey(key: string): ViewFieldRef | null {
  if (key.startsWith("field:")) return fieldRef(key.slice("field:".length));
  if (key.startsWith("pseudo:")) {
    const pseudo = Number(key.slice("pseudo:".length)) as Pseudo;
    return PSEUDO_FIELD_KINDS.has(pseudo) ? pseudoRef(pseudo) : null;
  }
  return null;
}

export function sameFieldRef(a: ViewFieldRef, b: ViewFieldRef): boolean {
  return fieldRefKey(a) === fieldRefKey(b);
}

export function isPseudoRef(ref: ViewFieldRef, pseudo: Pseudo): boolean {
  return ref.kind === "pseudo" && ref.pseudo === pseudo;
}

export function isFieldRef(ref: ViewFieldRef, fieldId: string): boolean {
  return ref.kind === "field" && ref.fieldId === fieldId;
}

/** Null when the ref names a field this project no longer has. */
export function fieldKindOf(
  ref: ViewFieldRef,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): FieldKind | null {
  if (ref.kind === "pseudo") return PSEUDO_FIELD_KINDS.get(ref.pseudo) ?? null;
  const field = fieldsById.get(ref.fieldId);
  return field ? FIELD_TYPE_KINDS[field.type] : null;
}

export function fieldRefLabel(
  ref: ViewFieldRef,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): string {
  if (ref.kind === "pseudo") return PSEUDO_FIELD_LABELS.get(ref.pseudo) ?? "Unknown attribute";
  return fieldsById.get(ref.fieldId)?.name ?? "Deleted field";
}

export function operatorsFor(kind: FieldKind, ref: ViewFieldRef): readonly Op[] {
  const operators = OPERATORS[kind];
  if (ref.kind === "pseudo" && NEVER_EMPTY_PSEUDO_FIELDS.has(ref.pseudo)) {
    return operators.filter((operator) => !EMPTINESS_OPERATORS.has(operator));
  }
  return operators;
}

export function isSortableKind(kind: FieldKind | null): boolean {
  return kind !== null && SORTABLE_KINDS.has(kind);
}

export function isGroupableKind(kind: FieldKind | null): boolean {
  return kind !== null && GROUPABLE_KINDS.has(kind);
}

export function flipDirection(direction: SortDirection): SortDirection {
  return direction === SortDirection.DESC ? SortDirection.ASC : SortDirection.DESC;
}
