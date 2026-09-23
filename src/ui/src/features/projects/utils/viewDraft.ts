import {
  FilterLogic,
  RoadmapZoom,
  SortDirection,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type {
  ViewColumnWidth,
  ViewDefinition,
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterGroup,
  ViewFilterNode,
  ViewLayout,
  ViewSortKey,
  ViewType,
} from "@/features/projects/types/views";
import { fieldRefKey, pseudoRef, sameFieldRef } from "@/features/projects/utils/viewFields";

/** Mirrors the backend definition limits so a draft never grows past what a save accepts. */
export const VIEW_LIMITS = {
  sortKeys: 5,
  minColumnWidth: 40,
  maxColumnWidth: 2000,
  collapsedKeys: 200,
  groupKeyLength: 200,
} as const;

export function layoutFor(type: ViewType): ViewLayout {
  switch (type) {
    case "table":
      return { type: "table", flat: false };
    case "board":
      return { type: "board", columnFieldId: "" };
    case "roadmap":
      return { type: "roadmap", zoom: RoadmapZoom.WEEK };
    case "backlog":
      return { type: "backlog" };
    case "graph":
      return { type: "graph", hideParentEdges: false };
    case "resources":
      return { type: "resources" };
  }
}

export function emptyDefinition(type: ViewType): ViewDefinition {
  return {
    layout: layoutFor(type),
    filter: null,
    sort: [],
    groupBy: null,
    visibleFields: [],
    columnWidths: [],
    collapsedGroupKeys: [],
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** An empty filter group and no filter are the same view. */
function normalizeForCompare(definition: ViewDefinition): ViewDefinition {
  return definition.filter && definition.filter.nodes.length === 0
    ? { ...definition, filter: null }
    : definition;
}

export function definitionsEqual(a: ViewDefinition, b: ViewDefinition): boolean {
  return (
    JSON.stringify(canonical(normalizeForCompare(a))) ===
    JSON.stringify(canonical(normalizeForCompare(b)))
  );
}

/** Sentinel for "no sprint" in the quick sprint filter; it reads as an `is empty` condition. */
export const NO_SPRINT = "__no_sprint__";

export type QuickFilterKind = "taskType" | "sprint" | "epic" | "tags" | "rootOnly";

export interface QuickFilterChip {
  kind: QuickFilterKind;
  /** Index of the condition in the top-level group; removing the chip removes exactly this node. */
  index: number;
  /** The picked id (sprint id or NO_SPRINT, epic id, task type); every tag id for tags. */
  values: string[];
}

function singleId(condition: ViewFilterCondition): string | null {
  const value = condition.value;
  if (value?.kind !== "ids") return null;
  const { ids, includeCurrentUser, includeEmpty, includeActiveSprint } = value.ids;
  if (includeCurrentUser || includeEmpty || includeActiveSprint || ids.length !== 1) return null;
  return ids[0];
}

function quickKindOf(condition: ViewFilterCondition): QuickFilterChip["kind"] | null {
  if (condition.field.kind !== "pseudo") return null;
  const { pseudo } = condition.field;
  if (pseudo === Pseudo.TASK_TYPE && condition.operator === Op.IS && singleId(condition)) {
    return "taskType";
  }
  if (pseudo === Pseudo.SPRINT) {
    if (condition.operator === Op.IS_EMPTY) return "sprint";
    if (condition.operator === Op.IS && singleId(condition)) return "sprint";
  }
  if (pseudo === Pseudo.EPIC && condition.operator === Op.IS && singleId(condition)) return "epic";
  if (pseudo === Pseudo.TAGS && condition.operator === Op.IS_ANY_OF) {
    const value = condition.value;
    if (
      value?.kind === "ids" &&
      value.ids.ids.length > 0 &&
      !value.ids.includeEmpty &&
      !value.ids.includeCurrentUser &&
      !value.ids.includeActiveSprint
    ) {
      return "tags";
    }
  }
  if (
    pseudo === Pseudo.DEPTH &&
    condition.operator === Op.IS &&
    condition.value?.kind === "number" &&
    condition.value.number === 0
  ) {
    return "rootOnly";
  }
  return null;
}

function chipValues(kind: QuickFilterKind, condition: ViewFilterCondition): string[] {
  if (kind === "rootOnly") return [];
  if (kind === "sprint" && condition.operator === Op.IS_EMPTY) return [NO_SPRINT];
  return condition.value?.kind === "ids" ? [...condition.value.ids.ids] : [];
}

export interface FilterSummary {
  chips: QuickFilterChip[];
  /** Top-level nodes that are not quick filters: builder conditions and nested groups. */
  otherCount: number;
}

/** Quick filters only exist at the top of an AND tree; under OR every node counts as a condition. */
export function summarizeFilter(filter: ViewFilterGroup | null): FilterSummary {
  if (!filter) return { chips: [], otherCount: 0 };
  if (filter.logic === FilterLogic.OR) return { chips: [], otherCount: filter.nodes.length };
  const chips: QuickFilterChip[] = [];
  const seen = new Set<QuickFilterKind>();
  let otherCount = 0;
  filter.nodes.forEach((node, index) => {
    const kind = node.kind === "condition" ? quickKindOf(node.condition) : null;
    if (kind && node.kind === "condition" && !seen.has(kind)) {
      seen.add(kind);
      chips.push({ kind, index, values: chipValues(kind, node.condition) });
    } else {
      otherCount += 1;
    }
  });
  return { chips, otherCount };
}

function idsCondition(pseudo: Pseudo, operator: Op, ids: string[]): ViewFilterNode {
  return {
    kind: "condition",
    condition: {
      field: pseudoRef(pseudo),
      operator,
      value: {
        kind: "ids",
        ids: { ids, includeCurrentUser: false, includeEmpty: false, includeActiveSprint: false },
      },
    },
  };
}

function quickCondition(kind: QuickFilterKind, values: string[]): ViewFilterNode | null {
  switch (kind) {
    case "taskType":
      return values[0] ? idsCondition(Pseudo.TASK_TYPE, Op.IS, [values[0]]) : null;
    case "epic":
      return values[0] ? idsCondition(Pseudo.EPIC, Op.IS, [values[0]]) : null;
    case "tags":
      return values.length > 0 ? idsCondition(Pseudo.TAGS, Op.IS_ANY_OF, values) : null;
    case "sprint":
      if (!values[0]) return null;
      return values[0] === NO_SPRINT
        ? {
            kind: "condition",
            condition: { field: pseudoRef(Pseudo.SPRINT), operator: Op.IS_EMPTY, value: null },
          }
        : idsCondition(Pseudo.SPRINT, Op.IS, [values[0]]);
    case "rootOnly":
      return values.length > 0
        ? {
            kind: "condition",
            condition: {
              field: pseudoRef(Pseudo.DEPTH),
              operator: Op.IS,
              value: { kind: "number", number: 0 },
            },
          }
        : null;
  }
}

function withNodes(nodes: ViewFilterNode[]): ViewFilterGroup | null {
  return nodes.length === 0 ? null : { logic: FilterLogic.AND, nodes };
}

/**
 * Replaces the quick filter of one kind; empty `values` removes it. An OR tree is wrapped as one
 * nested group first, so adding a quick filter narrows the view instead of widening it.
 */
export function setQuickFilter(
  filter: ViewFilterGroup | null,
  kind: QuickFilterKind,
  values: string[],
): ViewFilterGroup | null {
  let nodes: ViewFilterNode[] = [];
  if (filter && filter.nodes.length > 0) {
    nodes =
      filter.logic === FilterLogic.OR ? [{ kind: "group", group: filter } as const] : filter.nodes;
  }
  const existing = summarizeFilter(withNodes(nodes)).chips.find((chip) => chip.kind === kind);
  const next = quickCondition(kind, values);
  if (existing) {
    nodes = next
      ? nodes.map((node, index) => (index === existing.index ? next : node))
      : nodes.filter((_, index) => index !== existing.index);
  } else if (next) {
    nodes = [...nodes, next];
  }
  return withNodes(nodes);
}

export function removeFilterNode(
  filter: ViewFilterGroup | null,
  index: number,
): ViewFilterGroup | null {
  if (!filter) return null;
  const nodes = filter.nodes.filter((_, position) => position !== index);
  return nodes.length === 0 ? null : { ...filter, nodes };
}

/** Drops everything the builder owns and keeps the quick filters. */
export function clearBuilderNodes(filter: ViewFilterGroup | null): ViewFilterGroup | null {
  const { chips } = summarizeFilter(filter);
  if (!filter || chips.length === 0) return null;
  const keep = new Set(chips.map((chip) => chip.index));
  return withNodes(filter.nodes.filter((_, index) => keep.has(index)));
}

/**
 * Plain click sorts by this field alone and steps asc, desc, off; shift-click keeps the other
 * keys and appends this one, or steps its direction in place.
 */
export function toggleSortKey(
  sort: readonly ViewSortKey[],
  field: ViewFieldRef,
  append: boolean,
): ViewSortKey[] {
  const index = sort.findIndex((key) => sameFieldRef(key.field, field));
  const current = index === -1 ? null : sort[index];
  const step = (key: ViewSortKey | null): ViewSortKey | null => {
    if (!key) return { field, direction: SortDirection.ASC };
    return key.direction === SortDirection.ASC ? { field, direction: SortDirection.DESC } : null;
  };

  if (!append) {
    const alone = sort.length === 1 ? current : null;
    const next = step(alone);
    return next ? [next] : [];
  }
  if (!current) {
    return sort.length >= VIEW_LIMITS.sortKeys ? [...sort] : [...sort, step(null)!];
  }
  const next = step(current);
  return next
    ? sort.map((key, position) => (position === index ? next : key))
    : sort.filter((_, position) => position !== index);
}

/**
 * An empty list means every field; the first toggle writes the list out in project field order.
 */
export function toggleVisibleField(
  visible: readonly ViewFieldRef[],
  field: ViewFieldRef,
  allFields: readonly ViewFieldRef[],
  show: boolean,
): ViewFieldRef[] {
  const current = visible.length === 0 ? allFields : visible;
  const shown = new Set(current.map(fieldRefKey));
  if (show) shown.add(fieldRefKey(field));
  else shown.delete(fieldRefKey(field));
  const known = new Set(allFields.map(fieldRefKey));
  const ordered = allFields.filter((ref) => shown.has(fieldRefKey(ref)));
  // Fields the list names but the project no longer lists keep their place at the end.
  const orphans = current.filter(
    (ref) => shown.has(fieldRefKey(ref)) && !known.has(fieldRefKey(ref)),
  );
  return [...ordered, ...orphans];
}

export function isFieldVisible(visible: readonly ViewFieldRef[], field: ViewFieldRef): boolean {
  return visible.length === 0 || visible.some((ref) => sameFieldRef(ref, field));
}

export function columnWidthOf(
  widths: readonly ViewColumnWidth[],
  field: ViewFieldRef,
): number | null {
  return widths.find((column) => sameFieldRef(column.field, field))?.width ?? null;
}

export function withColumnWidth(
  widths: readonly ViewColumnWidth[],
  field: ViewFieldRef,
  width: number,
): ViewColumnWidth[] {
  const clamped = Math.round(
    Math.min(VIEW_LIMITS.maxColumnWidth, Math.max(VIEW_LIMITS.minColumnWidth, width)),
  );
  const rest = widths.filter((column) => !sameFieldRef(column.field, field));
  return [...rest, { field, width: clamped }];
}

/** The oldest collapsed key gives way once the view holds as many as a save accepts. */
export function toggleCollapsedKey(keys: readonly string[], key: string): string[] {
  if (key.length > VIEW_LIMITS.groupKeyLength) return [...keys];
  if (keys.includes(key)) return keys.filter((existing) => existing !== key);
  const next = [...keys, key];
  return next.length > VIEW_LIMITS.collapsedKeys ? next.slice(-VIEW_LIMITS.collapsedKeys) : next;
}
