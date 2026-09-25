import { clone, create, equals, toJsonString } from "@bufbuild/protobuf";
import {
  SortDirection,
  TaskFieldRefSchema,
  TaskFilterGroupSchema,
  TaskFilterNodeSchema,
  ViewDefinitionSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import type {
  TaskFieldRef,
  TaskFilterGroup,
  TaskFilterNode,
  TaskGroupBy,
  TaskPseudoField,
  TaskSort,
  ViewDefinition,
} from "@uniffy/proto/projects/v1/projects_pb";

export function fieldRef(fieldId: string): TaskFieldRef {
  return create(TaskFieldRefSchema, { ref: { case: "fieldId", value: fieldId } });
}

export function pseudoRef(pseudo: TaskPseudoField): TaskFieldRef {
  return create(TaskFieldRefSchema, { ref: { case: "pseudo", value: pseudo } });
}

/** Stable string form of a ref, for map keys and picker values. */
export function fieldRefKey(ref: TaskFieldRef | undefined): string {
  switch (ref?.ref.case) {
    case "fieldId":
      return `field:${ref.ref.value}`;
    case "pseudo":
      return `pseudo:${ref.ref.value}`;
    default:
      return "";
  }
}

export function isFieldRef(ref: TaskFieldRef | undefined, fieldId: string): boolean {
  return ref?.ref.case === "fieldId" && ref.ref.value === fieldId;
}

export function isPseudoRef(ref: TaskFieldRef | undefined, pseudo: TaskPseudoField): boolean {
  return ref?.ref.case === "pseudo" && ref.ref.value === pseudo;
}

function nodeKey(node: TaskFilterNode): string {
  return toJsonString(TaskFilterNodeSchema, node);
}

/**
 * Conditions in a group are commutative and id sets are unordered, so two trees that differ only
 * in order filter the same tasks and should not mark a view as changed.
 */
function canonicalGroup(group: TaskFilterGroup): TaskFilterGroup {
  const nodes = group.nodes.map((node) => {
    const copy = clone(TaskFilterNodeSchema, node);
    if (copy.node.case === "group") copy.node.value = canonicalGroup(copy.node.value);
    if (copy.node.case === "condition") {
      const value = copy.node.value.value?.value;
      if (value?.case === "ids") value.value.ids = [...value.value.ids].sort();
    }
    return copy;
  });
  nodes.sort((a, b) => nodeKey(a).localeCompare(nodeKey(b)));
  return create(TaskFilterGroupSchema, { logic: group.logic, nodes });
}

function canonical(definition: ViewDefinition): ViewDefinition {
  const copy = clone(ViewDefinitionSchema, definition);
  copy.filter =
    copy.filter && copy.filter.nodes.length > 0 ? canonicalGroup(copy.filter) : undefined;
  return copy;
}

export function definitionsEqual(a: ViewDefinition, b: ViewDefinition): boolean {
  return equals(ViewDefinitionSchema, canonical(a), canonical(b));
}

/** True when the server has to evaluate the view: a filter to apply or an order to sort by. */
export function shapesResults(definition: ViewDefinition): boolean {
  return (definition.filter?.nodes.length ?? 0) > 0 || definition.sort.length > 0;
}

/** Only the filter and the sort decide which tasks come back and in what order. */
export function resultKey(definition: ViewDefinition): string {
  const { filter, sort } = canonical(definition);
  return toJsonString(ViewDefinitionSchema, create(ViewDefinitionSchema, { filter, sort }));
}

export function withFilter(
  definition: ViewDefinition,
  filter: TaskFilterGroup | undefined,
): ViewDefinition {
  const copy = clone(ViewDefinitionSchema, definition);
  copy.filter = filter && filter.nodes.length > 0 ? filter : undefined;
  return copy;
}

export function withSort(definition: ViewDefinition, sort: TaskSort[]): ViewDefinition {
  const copy = clone(ViewDefinitionSchema, definition);
  copy.sort = sort;
  return copy;
}

export function withGroupBy(
  definition: ViewDefinition,
  groupBy: TaskGroupBy | undefined,
): ViewDefinition {
  const copy = clone(ViewDefinitionSchema, definition);
  copy.groupBy = groupBy;
  return copy;
}

export function isDescending(direction: SortDirection): boolean {
  return direction === SortDirection.DESC;
}
