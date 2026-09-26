import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import { SYSTEM_FIELD_IDS, type FieldDefinition } from "@/features/projects/types/fields";
import type {
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterIdSet,
  ViewFilterLimits,
  ViewFilterNode,
} from "@/features/projects/types/views";
import {
  EMPTINESS_OPERATORS,
  SINGLE_ID_OPERATORS,
  fieldKindOf,
  fieldRef,
  fieldRefKey,
  pseudoRef,
  type FieldKind,
} from "@/features/projects/utils/viewFields";
import { randomUUID } from "@/shared/utils/uuid";

export interface EditorCondition {
  id: string;
  kind: "condition";
  condition: ViewFilterCondition;
}

export interface EditorGroup {
  id: string;
  kind: "group";
  logic: FilterLogic;
  children: EditorNode[];
}

/** The builder's working copy of a filter tree; ids only key the rows while editing. */
export type EditorNode = EditorCondition | EditorGroup;

export const NO_ID_SET: ViewFilterIdSet = {
  ids: [],
  includeCurrentUser: false,
  includeEmpty: false,
  includeActiveSprint: false,
};

export function editorGroup(
  logic: FilterLogic = FilterLogic.AND,
  children: EditorNode[] = [],
): EditorGroup {
  return { id: randomUUID(), kind: "group", logic, children };
}

function editorNode(node: ViewFilterNode): EditorNode {
  return node.kind === "condition"
    ? { id: randomUUID(), kind: "condition", condition: node.condition }
    : toEditorTree(node.group);
}

export function toEditorTree(filter: ViewFilterGroup | null): EditorGroup {
  return editorGroup(filter?.logic ?? FilterLogic.AND, (filter?.nodes ?? []).map(editorNode));
}

/** The tree without rows the server would refuse; empty groups fall away. */
export function fromEditorTree(
  root: EditorGroup,
  limits: ViewFilterLimits,
): ViewFilterGroup | null {
  const group = (node: EditorGroup): ViewFilterGroup | null => {
    const nodes: ViewFilterNode[] = [];
    for (const child of node.children) {
      if (child.kind === "condition") {
        if (isConditionComplete(child.condition, limits)) {
          nodes.push({ kind: "condition", condition: child.condition });
        }
      } else {
        const nested = group(child);
        if (nested) nodes.push({ kind: "group", group: nested });
      }
    }
    return nodes.length === 0 ? null : { logic: node.logic, nodes };
  };
  return group(root);
}

export function mapNode(
  root: EditorGroup,
  id: string,
  update: (node: EditorNode) => EditorNode,
): EditorGroup {
  const visit = (node: EditorNode): EditorNode => {
    if (node.id === id) return update(node);
    return node.kind === "group" ? { ...node, children: node.children.map(visit) } : node;
  };
  return visit(root) as EditorGroup;
}

export function removeNode(root: EditorGroup, id: string): EditorGroup {
  const visit = (group: EditorGroup): EditorGroup => ({
    ...group,
    children: group.children
      .filter((child) => child.id !== id)
      .map((child) => (child.kind === "group" ? visit(child) : child)),
  });
  return visit(root);
}

export function appendChild(root: EditorGroup, groupId: string, child: EditorNode): EditorGroup {
  return mapNode(root, groupId, (node) =>
    node.kind === "group" ? { ...node, children: [...node.children, child] } : node,
  );
}

export function countNodes(root: EditorGroup): number {
  return root.children.reduce(
    (sum, child) => sum + 1 + (child.kind === "group" ? countNodes(child) : 0),
    0,
  );
}

export function filterTreeLimitProblem(root: EditorGroup, limits: ViewFilterLimits): string | null {
  const exceedsDepth = (group: EditorGroup, depth: number): boolean =>
    depth > limits.maxDepth ||
    group.children.some((child) => child.kind === "group" && exceedsDepth(child, depth + 1));
  if (exceedsDepth(root, 1)) {
    return `Use at most ${limits.maxDepth} levels of filter groups.`;
  }
  if (countNodes(root) > limits.maxNodes) {
    return `Use at most ${limits.maxNodes} filter conditions and groups.`;
  }
  return null;
}

/**
 * Adds a node so it narrows what the tree matches: under an OR with more than one branch, the
 * existing branches become one nested group first.
 */
export function appendNarrowing(root: EditorGroup, node: EditorNode): EditorGroup {
  if (root.logic === FilterLogic.OR && root.children.length > 1) {
    return editorGroup(FilterLogic.AND, [{ ...root, id: randomUUID() }, node]);
  }
  return { ...root, logic: FilterLogic.AND, children: [...root.children, node] };
}

function idCount(set: ViewFilterIdSet): number {
  return (
    set.ids.length +
    Number(set.includeCurrentUser) +
    Number(set.includeEmpty) +
    Number(set.includeActiveSprint)
  );
}

function isDateComplete(date: ViewFilterDate, limits: ViewFilterLimits): boolean {
  if (date.kind === "relative") return Math.abs(date.offsetDays) <= limits.maxRelativeOffsetDays;
  return /^\d{4}-\d{2}-\d{2}$/.test(date.date);
}

/** Incomplete rows stay in the editor but never reach the view: the server would refuse them. */
export function isConditionComplete(
  condition: ViewFilterCondition,
  limits: ViewFilterLimits,
): boolean {
  if (EMPTINESS_OPERATORS.has(condition.operator)) return condition.value === null;
  const value = condition.value;
  if (!value) return false;
  switch (value.kind) {
    case "ids": {
      const count = idCount(value.ids);
      if (value.ids.ids.length > limits.maxIdsPerCondition) return false;
      if (condition.operator === Op.IS_ALL_OF && value.ids.includeEmpty) return false;
      return SINGLE_ID_OPERATORS.has(condition.operator) ? count === 1 : count > 0;
    }
    case "text":
      return value.text.trim().length > 0 && value.text.length <= limits.maxTextLength;
    case "number":
      return Number.isFinite(value.number);
    case "numberRange":
      return Number.isFinite(value.min) && Number.isFinite(value.max) && value.min <= value.max;
    case "date":
      return isDateComplete(value.date, limits);
    case "dateRange":
      return isDateComplete(value.start, limits) && isDateComplete(value.end, limits);
    case "flag":
      return true;
  }
}

/**
 * Why the server would refuse to save this condition, if it would: a field deleted in settings,
 * or a select option removed since the condition was built.
 */
export function conditionProblem(
  condition: ViewFilterCondition,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): string | null {
  if (condition.field.kind !== "field") return null;
  const field = fieldsById.get(condition.field.fieldId);
  if (!field) return "This field was deleted. Remove the condition to save the view.";
  if (
    (field.type === "single_select" || field.type === "multi_select") &&
    condition.value?.kind === "ids"
  ) {
    const known = new Set((field.config.options ?? []).map((option) => option.id));
    if (condition.value.ids.ids.some((id) => !known.has(id))) {
      return "An option picked here was deleted. Pick again to save the view.";
    }
  }
  return null;
}

export function hasFilterProblems(
  filter: ViewFilterGroup | null,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): boolean {
  if (!filter) return false;
  return filter.nodes.some((node) =>
    node.kind === "condition"
      ? conditionProblem(node.condition, fieldsById) !== null
      : hasFilterProblems(node.group, fieldsById),
  );
}

export type FilterPreset = "myTasks" | "unassigned" | "overdue" | "dueThisWeek" | "completedWeek";

export const FILTER_PRESETS: readonly { preset: FilterPreset; label: string }[] = [
  { preset: "myTasks", label: "My tasks" },
  { preset: "unassigned", label: "Unassigned" },
  { preset: "overdue", label: "Overdue" },
  { preset: "dueThisWeek", label: "Due this week" },
  { preset: "completedWeek", label: "Completed last 7 days" },
];

const ASSIGNEE = fieldRef(SYSTEM_FIELD_IDS.ASSIGNEE);
const DUE = fieldRef(SYSTEM_FIELD_IDS.DUE_DATE);
const COMPLETED = pseudoRef(Pseudo.COMPLETED_AT);

function relative(anchor: RelativeDateAnchor, offsetDays = 0): ViewFilterDate {
  return { kind: "relative", anchor, offsetDays };
}

function conditionNode(
  field: ViewFieldRef,
  operator: Op,
  value: ViewFilterCondition["value"],
): ViewFilterNode {
  return { kind: "condition", condition: { field, operator, value } };
}

/** The trees the phone reads back as its own facets, so a preset looks the same on both. */
export function presetNode(preset: FilterPreset): ViewFilterNode {
  switch (preset) {
    case "myTasks":
      return conditionNode(ASSIGNEE, Op.IS_ANY_OF, {
        kind: "ids",
        ids: { ...NO_ID_SET, includeCurrentUser: true },
      });
    case "unassigned":
      return conditionNode(ASSIGNEE, Op.IS_EMPTY, null);
    case "overdue":
      return {
        kind: "group",
        group: {
          logic: FilterLogic.AND,
          nodes: [
            conditionNode(DUE, Op.BEFORE, {
              kind: "date",
              date: relative(RelativeDateAnchor.TODAY),
            }),
            conditionNode(COMPLETED, Op.IS_EMPTY, null),
          ],
        },
      };
    case "dueThisWeek":
      return conditionNode(DUE, Op.BETWEEN, {
        kind: "dateRange",
        start: relative(RelativeDateAnchor.START_OF_WEEK),
        end: relative(RelativeDateAnchor.END_OF_WEEK),
      });
    case "completedWeek":
      return conditionNode(COMPLETED, Op.ON_OR_AFTER, {
        kind: "date",
        date: relative(RelativeDateAnchor.TODAY, -6),
      });
  }
}

export function withPreset(root: EditorGroup, preset: FilterPreset): EditorGroup {
  return appendNarrowing(root, editorNode(presetNode(preset)));
}

function isRelative(date: ViewFilterDate | undefined, anchor: RelativeDateAnchor, offset = 0) {
  return date?.kind === "relative" && date.anchor === anchor && date.offsetDays === offset;
}

/** Due before today and not completed, as one AND group: the definition mobile reads as Overdue. */
export function isOverdueGroup(group: ViewFilterGroup): boolean {
  if (group.logic === FilterLogic.OR || group.nodes.length !== 2) return false;
  const conditions = group.nodes.flatMap((node) =>
    node.kind === "condition" ? [node.condition] : [],
  );
  const due = conditions.find((c) => fieldRefKey(c.field) === fieldRefKey(DUE));
  const completed = conditions.find((c) => fieldRefKey(c.field) === fieldRefKey(COMPLETED));
  return (
    conditions.length === 2 &&
    due?.operator === Op.BEFORE &&
    due.value?.kind === "date" &&
    isRelative(due.value.date, RelativeDateAnchor.TODAY) &&
    completed?.operator === Op.IS_EMPTY
  );
}

export interface FilterLabels {
  field: (ref: ViewFieldRef) => string;
  /** A picked value: option, person, tag, sprint, task or task type. */
  value: (ref: ViewFieldRef, kind: FieldKind, id: string) => string;
  /** A fixed YYYY-MM-DD date. */
  date: (date: string) => string;
}

const ANCHOR_WORDS: Partial<Record<RelativeDateAnchor, string>> = {
  [RelativeDateAnchor.TODAY]: "today",
  [RelativeDateAnchor.START_OF_WEEK]: "the start of the week",
  [RelativeDateAnchor.END_OF_WEEK]: "the end of the week",
  [RelativeDateAnchor.START_OF_MONTH]: "the start of the month",
  [RelativeDateAnchor.END_OF_MONTH]: "the end of the month",
};

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

export function describeDate(date: ViewFilterDate, labels: Pick<FilterLabels, "date">): string {
  if (date.kind === "fixed") return labels.date(date.date);
  const { anchor, offsetDays } = date;
  if (anchor === RelativeDateAnchor.TODAY) {
    if (offsetDays === 0) return "today";
    if (offsetDays === -1) return "yesterday";
    if (offsetDays === 1) return "tomorrow";
    return offsetDays < 0 ? `${days(-offsetDays)} ago` : `${days(offsetDays)} from today`;
  }
  const word = ANCHOR_WORDS[anchor] ?? "today";
  if (offsetDays === 0) return word;
  return offsetDays < 0
    ? `${days(-offsetDays)} before ${word}`
    : `${days(offsetDays)} after ${word}`;
}

function joinWords(words: string[], last: "or" | "and"): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length > 3) return `${words.slice(0, 2).join(", ")} ${last} ${words.length - 2} more`;
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

const EMPTY_WORDS: Partial<Record<FieldKind, string>> = {
  person: "unassigned",
  sprint: "the backlog",
  tags: "untagged",
};

const BOOLEAN_WORDS: Partial<Record<Pseudo, [yes: string, no: string]>> = {
  [Pseudo.IS_BLOCKED]: ["Blocked", "Not blocked"],
  [Pseudo.IS_MILESTONE]: ["Milestone", "Not a milestone"],
  [Pseudo.HAS_SUBTASKS]: ["Has subtasks", "No subtasks"],
};

function idWords(condition: ViewFilterCondition, kind: FieldKind, labels: FilterLabels): string[] {
  if (condition.value?.kind !== "ids") return [];
  const set = condition.value.ids;
  const words: string[] = [];
  if (set.includeCurrentUser) words.push("me");
  words.push(...set.ids.map((id) => labels.value(condition.field, kind, id)));
  if (set.includeActiveSprint) words.push("the active sprint");
  if (set.includeEmpty) words.push(EMPTY_WORDS[kind] ?? "empty");
  return words;
}

/** One condition as a sentence, the way a chip reads it: "Assignee is me or unassigned". */
export function describeCondition(
  condition: ViewFilterCondition,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  labels: FilterLabels,
): string {
  const field = labels.field(condition.field);
  const kind = fieldKindOf(condition.field, fieldsById);
  const { operator, value } = condition;
  if (!kind) return "Condition on a deleted field";
  if (operator === Op.IS_EMPTY) {
    if (kind === "person") return `${field} is unassigned`;
    if (kind === "sprint") return "In the backlog";
    if (kind === "tags") return "Untagged";
    return `${field} is empty`;
  }
  if (operator === Op.IS_NOT_EMPTY) {
    return kind === "person" ? `${field} is assigned` : `${field} is not empty`;
  }

  if (kind === "boolean") {
    const flag = value?.kind === "flag" ? value.flag : true;
    const words = condition.field.kind === "pseudo" ? BOOLEAN_WORDS[condition.field.pseudo] : null;
    if (words) return flag ? words[0] : words[1];
    return `${field} is ${flag ? "yes" : "no"}`;
  }

  if (kind === "number") {
    if (
      condition.field.kind === "pseudo" &&
      condition.field.pseudo === Pseudo.DEPTH &&
      operator === Op.IS &&
      value?.kind === "number" &&
      value.number === 0
    ) {
      return "Top-level only";
    }
    if (value?.kind === "numberRange") return `${field} is between ${value.min} and ${value.max}`;
    const number = value?.kind === "number" ? value.number : "";
    switch (operator) {
      case Op.IS_NOT:
        return `${field} is not ${number}`;
      case Op.GREATER_THAN:
        return `${field} is over ${number}`;
      case Op.LESS_THAN:
        return `${field} is under ${number}`;
      default:
        return `${field} is ${number}`;
    }
  }

  if (kind === "text") {
    const text = value?.kind === "text" ? `"${value.text}"` : "";
    switch (operator) {
      case Op.CONTAINS:
        return `${field} contains ${text}`;
      case Op.NOT_CONTAINS:
        return `${field} does not contain ${text}`;
      case Op.IS_NOT:
        return `${field} is not ${text}`;
      default:
        return `${field} is ${text}`;
    }
  }

  if (kind === "date" || kind === "timestamp") {
    if (value?.kind === "dateRange") {
      if (
        isRelative(value.start, RelativeDateAnchor.START_OF_WEEK) &&
        isRelative(value.end, RelativeDateAnchor.END_OF_WEEK)
      ) {
        return `${field} this week`;
      }
      if (
        isRelative(value.start, RelativeDateAnchor.START_OF_MONTH) &&
        isRelative(value.end, RelativeDateAnchor.END_OF_MONTH)
      ) {
        return `${field} this month`;
      }
      return `${field} between ${describeDate(value.start, labels)} and ${describeDate(value.end, labels)}`;
    }
    if (value?.kind !== "date") return field;
    const date = value.date;
    if (
      operator === Op.ON_OR_AFTER &&
      date.kind === "relative" &&
      date.anchor === RelativeDateAnchor.TODAY &&
      date.offsetDays < 0
    ) {
      return `${field} in the last ${days(1 - date.offsetDays)}`;
    }
    const when = describeDate(date, labels);
    switch (operator) {
      case Op.BEFORE:
        return `${field} before ${when}`;
      case Op.AFTER:
        return `${field} after ${when}`;
      case Op.ON_OR_BEFORE:
        return `${field} on or before ${when}`;
      case Op.ON_OR_AFTER:
        return `${field} on or after ${when}`;
      default:
        return `${field} is ${when}`;
    }
  }

  const words = idWords(condition, kind, labels);
  switch (operator) {
    case Op.IS_NOT:
    case Op.IS_NONE_OF:
      return `${field} is not ${joinWords(words, "or")}`;
    case Op.IS_ALL_OF:
      return `${field} has ${joinWords(words, "and")}`;
    default:
      return `${field} is ${joinWords(words, "or")}`;
  }
}

/** A top-level node as one chip; a nested group reads as a whole and opens the builder. */
export function describeNode(
  node: ViewFilterNode,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  labels: FilterLabels,
): string {
  if (node.kind === "condition") return describeCondition(node.condition, fieldsById, labels);
  if (isOverdueGroup(node.group)) return "Overdue";
  const count = node.group.nodes.length;
  const noun = count === 1 ? "condition" : "conditions";
  return node.group.logic === FilterLogic.OR
    ? `Any of ${count} ${noun}`
    : `All of ${count} ${noun}`;
}
