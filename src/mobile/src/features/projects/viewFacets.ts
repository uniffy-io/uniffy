import { create, type MessageInitShape } from "@bufbuild/protobuf";
import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterDateSchema,
  TaskFilterGroupSchema,
  TaskFilterNodeSchema,
  TaskFilterValueSchema,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type {
  TaskFieldRef,
  TaskFilterCondition,
  TaskFilterConditionSchema,
  TaskFilterDate,
  TaskFilterGroup,
  TaskFilterNode,
} from "@uniffy/proto/projects/v1/projects_pb";
import {
  ASSIGNEE_FIELD_ID,
  DUE_DATE_FIELD_ID,
  PRIORITY_FIELD_ID,
  STATUS_FIELD_ID,
} from "@features/projects/projectsSerializer";
import { fieldRef, fieldRefKey, pseudoRef } from "@features/projects/viewDefinition";

/**
 * The filter sheet edits a view's filter as facets, one top-level AND condition each. Every other
 * node is kept as written and only counted, so a phone edit never loosens what the web built.
 */
export type IdFacet =
  | "status"
  | "priority"
  | "assignee"
  | "creator"
  | "tags"
  | "taskType"
  | "sprint"
  | "epic";

export type IdFlag = "me" | "empty" | "active";

export interface IdChoice {
  ids: string[];
  /** The caller, resolved by the server; person facets only. */
  me: boolean;
  /** Unassigned, or no sprint. */
  empty: boolean;
  /** The project's active sprint at evaluation time. */
  active: boolean;
}

export type DuePreset = "overdue" | "today" | "thisWeek" | "next7Days" | "none";

export interface TaskFacets {
  ids: Record<IdFacet, IdChoice>;
  due: DuePreset | null;
  milestone: boolean;
}

export interface FacetReading {
  facets: TaskFacets;
  /** Nodes the sheet cannot show as a facet, kept untouched on every edit. */
  advancedCount: number;
}

const ID_FACETS: Record<IdFacet, { ref: TaskFieldRef; flags: readonly IdFlag[] }> = {
  status: { ref: fieldRef(STATUS_FIELD_ID), flags: [] },
  priority: { ref: fieldRef(PRIORITY_FIELD_ID), flags: [] },
  assignee: { ref: fieldRef(ASSIGNEE_FIELD_ID), flags: ["me", "empty"] },
  creator: { ref: pseudoRef(Pseudo.CREATOR), flags: ["me"] },
  tags: { ref: pseudoRef(Pseudo.TAGS), flags: [] },
  taskType: { ref: pseudoRef(Pseudo.TASK_TYPE), flags: [] },
  sprint: { ref: pseudoRef(Pseudo.SPRINT), flags: ["active", "empty"] },
  epic: { ref: pseudoRef(Pseudo.EPIC), flags: [] },
};

const ID_FACET_ORDER = Object.keys(ID_FACETS) as IdFacet[];
const ID_FACET_BY_REF = new Map(
  ID_FACET_ORDER.map((facet) => [fieldRefKey(ID_FACETS[facet].ref), facet]),
);

const DUE_REF = fieldRef(DUE_DATE_FIELD_ID);
const MILESTONE_REF = pseudoRef(Pseudo.IS_MILESTONE);
const COMPLETED_REF = pseudoRef(Pseudo.COMPLETED_AT);

export const NO_ID_CHOICE: IdChoice = Object.freeze({
  ids: [],
  me: false,
  empty: false,
  active: false,
}) as IdChoice;

export const NO_FACETS: TaskFacets = {
  ids: {
    status: NO_ID_CHOICE,
    priority: NO_ID_CHOICE,
    assignee: NO_ID_CHOICE,
    creator: NO_ID_CHOICE,
    tags: NO_ID_CHOICE,
    taskType: NO_ID_CHOICE,
    sprint: NO_ID_CHOICE,
    epic: NO_ID_CHOICE,
  },
  due: null,
  milestone: false,
};

export function isChoiceEmpty(choice: IdChoice): boolean {
  return choice.ids.length === 0 && !choice.me && !choice.empty && !choice.active;
}

export function toggleId(choice: IdChoice, id: string): IdChoice {
  const ids = choice.ids.includes(id) ? choice.ids.filter((v) => v !== id) : [...choice.ids, id];
  return { ...choice, ids };
}

export function toggleFlag(choice: IdChoice, flag: IdFlag): IdChoice {
  return { ...choice, [flag]: !choice[flag] };
}

export function activeFacetCount(facets: TaskFacets): number {
  const idCount = ID_FACET_ORDER.filter((facet) => !isChoiceEmpty(facets.ids[facet])).length;
  return idCount + (facets.due ? 1 : 0) + (facets.milestone ? 1 : 0);
}

function relative(anchor: RelativeDateAnchor, offsetDays = 0): TaskFilterDate {
  return create(TaskFilterDateSchema, {
    value: { case: "relative", value: { anchor, offsetDays } },
  });
}

function isRelative(
  date: TaskFilterDate | undefined,
  anchor: RelativeDateAnchor,
  offsetDays = 0,
): boolean {
  return (
    date?.value.case === "relative" &&
    date.value.value.anchor === anchor &&
    date.value.value.offsetDays === offsetDays
  );
}

function conditionNode(
  condition: MessageInitShape<typeof TaskFilterConditionSchema>,
): TaskFilterNode {
  return create(TaskFilterNodeSchema, { node: { case: "condition", value: condition } });
}

function readIdChoice(facet: IdFacet, condition: TaskFilterCondition): IdChoice | null {
  const allowed = ID_FACETS[facet].flags;
  if (condition.operator === Op.IS_EMPTY) {
    return allowed.includes("empty") ? { ...NO_ID_CHOICE, empty: true } : null;
  }
  if (condition.operator !== Op.IS_ANY_OF && condition.operator !== Op.IS) return null;
  const value = condition.value?.value;
  if (value?.case !== "ids") return null;
  const set = value.value;
  const choice: IdChoice = {
    ids: [...set.ids],
    me: set.includeCurrentUser,
    empty: set.includeEmpty,
    active: set.includeActiveSprint,
  };
  const flagged = (["me", "empty", "active"] as const).filter((flag) => choice[flag]);
  if (flagged.some((flag) => !allowed.includes(flag))) return null;
  return isChoiceEmpty(choice) ? null : choice;
}

function readDue(condition: TaskFilterCondition): DuePreset | null {
  const value = condition.value?.value;
  switch (condition.operator) {
    case Op.IS_EMPTY:
      return "none";
    case Op.IS:
      return value?.case === "date" && isRelative(value.value, RelativeDateAnchor.TODAY)
        ? "today"
        : null;
    case Op.BETWEEN: {
      if (value?.case !== "dateRange") return null;
      const { start, end } = value.value;
      if (
        isRelative(start, RelativeDateAnchor.START_OF_WEEK) &&
        isRelative(end, RelativeDateAnchor.END_OF_WEEK)
      ) {
        return "thisWeek";
      }
      if (
        isRelative(start, RelativeDateAnchor.TODAY) &&
        isRelative(end, RelativeDateAnchor.TODAY, 6)
      ) {
        return "next7Days";
      }
      return null;
    }
    default:
      return null;
  }
}

function conditionOf(node: TaskFilterNode): TaskFilterCondition | null {
  return node.node.case === "condition" ? node.node.value : null;
}

/** Due before today and not completed, kept together as one facet. */
function isOverdueGroup(node: TaskFilterNode): boolean {
  if (node.node.case !== "group") return false;
  const group = node.node.value;
  if (group.logic === FilterLogic.OR || group.nodes.length !== 2) return false;
  const [first, second] = group.nodes.map(conditionOf);
  if (!first || !second) return false;
  const pair = [first, second];
  const due = pair.find((c) => fieldRefKey(c.field) === fieldRefKey(DUE_REF));
  const completed = pair.find((c) => fieldRefKey(c.field) === fieldRefKey(COMPLETED_REF));
  return (
    !!due &&
    !!completed &&
    due.operator === Op.BEFORE &&
    due.value?.value.case === "date" &&
    isRelative(due.value.value.value, RelativeDateAnchor.TODAY) &&
    completed.operator === Op.IS_EMPTY
  );
}

type FacetSlot =
  | { kind: "id"; facet: IdFacet; choice: IdChoice }
  | { kind: "due"; due: DuePreset }
  | { kind: "milestone" };

function slotOf(node: TaskFilterNode): FacetSlot | null {
  if (isOverdueGroup(node)) return { kind: "due", due: "overdue" };
  const condition = conditionOf(node);
  if (!condition) return null;
  const key = fieldRefKey(condition.field);
  const facet = ID_FACET_BY_REF.get(key);
  if (facet) {
    const choice = readIdChoice(facet, condition);
    return choice ? { kind: "id", facet, choice } : null;
  }
  if (key === fieldRefKey(DUE_REF)) {
    const due = readDue(condition);
    return due ? { kind: "due", due } : null;
  }
  if (
    key === fieldRefKey(MILESTONE_REF) &&
    condition.operator === Op.IS &&
    condition.value?.value.case === "flag" &&
    condition.value.value.value
  ) {
    return { kind: "milestone" };
  }
  return null;
}

function slotName(slot: FacetSlot): string {
  return slot.kind === "id" ? slot.facet : slot.kind;
}

/** Facets only exist at the top of an AND tree; a top-level OR is one advanced node as a whole. */
function topLevelNodes(filter: TaskFilterGroup | undefined): {
  nodes: TaskFilterNode[];
  wrapped: boolean;
} {
  if (!filter || filter.nodes.length === 0) return { nodes: [], wrapped: false };
  if (filter.logic === FilterLogic.OR && filter.nodes.length > 1) {
    return {
      nodes: [create(TaskFilterNodeSchema, { node: { case: "group", value: filter } })],
      wrapped: true,
    };
  }
  return { nodes: filter.nodes, wrapped: false };
}

/** Walks the top-level nodes once, pairing each with the facet it stands for, if any. */
function classify(nodes: TaskFilterNode[]): { node: TaskFilterNode; slot: FacetSlot | null }[] {
  const taken = new Set<string>();
  return nodes.map((node) => {
    const slot = slotOf(node);
    if (!slot || taken.has(slotName(slot))) return { node, slot: null };
    taken.add(slotName(slot));
    return { node, slot };
  });
}

export function readFacets(filter: TaskFilterGroup | undefined): FacetReading {
  const facets: TaskFacets = { ...NO_FACETS, ids: { ...NO_FACETS.ids } };
  let advancedCount = 0;
  for (const { slot } of classify(topLevelNodes(filter).nodes)) {
    if (!slot) advancedCount += 1;
    else if (slot.kind === "id") facets.ids[slot.facet] = slot.choice;
    else if (slot.kind === "due") facets.due = slot.due;
    else facets.milestone = true;
  }
  return { facets, advancedCount };
}

function idNode(facet: IdFacet, choice: IdChoice): TaskFilterNode {
  return conditionNode({
    field: ID_FACETS[facet].ref,
    operator: Op.IS_ANY_OF,
    value: {
      value: {
        case: "ids",
        value: {
          ids: choice.ids,
          includeCurrentUser: choice.me,
          includeEmpty: choice.empty,
          includeActiveSprint: choice.active,
        },
      },
    },
  });
}

function dueNode(due: DuePreset): TaskFilterNode {
  const dateValue = (date: TaskFilterDate) =>
    create(TaskFilterValueSchema, { value: { case: "date", value: date } });
  switch (due) {
    case "none":
      return conditionNode({ field: DUE_REF, operator: Op.IS_EMPTY });
    case "today":
      return conditionNode({
        field: DUE_REF,
        operator: Op.IS,
        value: dateValue(relative(RelativeDateAnchor.TODAY)),
      });
    case "thisWeek":
    case "next7Days": {
      const [start, end] =
        due === "thisWeek"
          ? [relative(RelativeDateAnchor.START_OF_WEEK), relative(RelativeDateAnchor.END_OF_WEEK)]
          : [relative(RelativeDateAnchor.TODAY), relative(RelativeDateAnchor.TODAY, 6)];
      return conditionNode({
        field: DUE_REF,
        operator: Op.BETWEEN,
        value: { value: { case: "dateRange", value: { start, end } } },
      });
    }
    case "overdue":
      return create(TaskFilterNodeSchema, {
        node: {
          case: "group",
          value: create(TaskFilterGroupSchema, {
            logic: FilterLogic.AND,
            nodes: [
              conditionNode({
                field: DUE_REF,
                operator: Op.BEFORE,
                value: dateValue(relative(RelativeDateAnchor.TODAY)),
              }),
              conditionNode({ field: COMPLETED_REF, operator: Op.IS_EMPTY }),
            ],
          }),
        },
      });
  }
}

function milestoneNode(): TaskFilterNode {
  return conditionNode({
    field: MILESTONE_REF,
    operator: Op.IS,
    value: { value: { case: "flag", value: true } },
  });
}

function facetNode(name: string, facets: TaskFacets): TaskFilterNode | null {
  if (name === "due") return facets.due ? dueNode(facets.due) : null;
  if (name === "milestone") return facets.milestone ? milestoneNode() : null;
  const facet = name as IdFacet;
  const choice = facets.ids[facet];
  return isChoiceEmpty(choice) ? null : idNode(facet, choice);
}

function group(nodes: TaskFilterNode[]): TaskFilterGroup | undefined {
  return nodes.length === 0
    ? undefined
    : create(TaskFilterGroupSchema, { logic: FilterLogic.AND, nodes });
}

/**
 * Rewrites each facet in place and appends new ones, so the web builder keeps its order. A
 * top-level OR is nested as one group first, so a facet narrows the view instead of widening it.
 */
export function applyFacets(
  filter: TaskFilterGroup | undefined,
  facets: TaskFacets,
): TaskFilterGroup | undefined {
  const emitted = new Set<string>();
  const nodes: TaskFilterNode[] = [];
  for (const { node, slot } of classify(topLevelNodes(filter).nodes)) {
    if (!slot) {
      nodes.push(node);
      continue;
    }
    const name = slotName(slot);
    emitted.add(name);
    const next = facetNode(name, facets);
    if (next) nodes.push(next);
  }
  for (const name of [...ID_FACET_ORDER, "due", "milestone"]) {
    if (emitted.has(name)) continue;
    const next = facetNode(name, facets);
    if (next) nodes.push(next);
  }
  return group(nodes);
}

/** Drops what the sheet cannot show and keeps the facets. */
export function clearAdvanced(filter: TaskFilterGroup | undefined): TaskFilterGroup | undefined {
  const { nodes, wrapped } = topLevelNodes(filter);
  if (wrapped) return undefined;
  return group(
    classify(nodes)
      .filter(({ slot }) => slot !== null)
      .map(({ node }) => node),
  );
}
