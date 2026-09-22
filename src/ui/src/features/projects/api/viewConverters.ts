import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  TaskFilterOperator,
  ViewDefinitionSchema,
  ViewType as ProtoViewType,
  type TaskFieldRefSchema,
  type TaskFilterDateSchema,
  type TaskFilterGroupSchema,
  type TaskFilterValueSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import type {
  TaskFieldRef as ProtoTaskFieldRef,
  TaskFilterCondition as ProtoTaskFilterCondition,
  TaskFilterDate as ProtoTaskFilterDate,
  TaskFilterGroup as ProtoTaskFilterGroup,
  TaskFilterNode as ProtoTaskFilterNode,
  TaskFilterValue as ProtoTaskFilterValue,
  ViewConfig as ProtoViewConfig,
  ViewDefinition as ProtoViewDefinition,
} from "@uniffy/proto/projects/v1/projects_pb";
import type {
  ViewConfig,
  ViewDefinition,
  ViewFieldRef,
  ViewFilterCondition,
  ViewFilterDate,
  ViewFilterGroup,
  ViewFilterNode,
  ViewFilterValue,
  ViewLayout,
  ViewType,
} from "@/features/projects/types/views";

type FieldRefInit = MessageInitShape<typeof TaskFieldRefSchema>;
type FilterGroupInit = MessageInitShape<typeof TaskFilterGroupSchema>;
type FilterValueInit = MessageInitShape<typeof TaskFilterValueSchema>;
type FilterDateInit = MessageInitShape<typeof TaskFilterDateSchema>;
type LayoutInit = MessageInitShape<typeof ViewDefinitionSchema>["layout"];

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export function protoViewTypeToFrontend(type: ProtoViewType): ViewType {
  switch (type) {
    case ProtoViewType.TABLE:
      return "table";
    case ProtoViewType.BOARD:
      return "board";
    case ProtoViewType.ROADMAP:
      return "roadmap";
    case ProtoViewType.BACKLOG:
      return "backlog";
    case ProtoViewType.GRAPH:
      return "graph";
    case ProtoViewType.RESOURCES:
      return "resources";
    default:
      return "table";
  }
}

function fieldRefFromProto(ref: ProtoTaskFieldRef | undefined): ViewFieldRef | null {
  switch (ref?.ref.case) {
    case "fieldId":
      return { kind: "field", fieldId: ref.ref.value };
    case "pseudo":
      return { kind: "pseudo", pseudo: ref.ref.value };
    default:
      return null;
  }
}

function filterDateFromProto(date: ProtoTaskFilterDate | undefined): ViewFilterDate | null {
  switch (date?.value.case) {
    case "fixed":
      return { kind: "fixed", date: date.value.value };
    case "relative":
      return {
        kind: "relative",
        anchor: date.value.value.anchor,
        offsetDays: date.value.value.offsetDays,
      };
    default:
      return null;
  }
}

function filterValueFromProto(value: ProtoTaskFilterValue): ViewFilterValue | null {
  const { value: inner } = value;
  switch (inner.case) {
    case "ids":
      return {
        kind: "ids",
        ids: {
          ids: [...inner.value.ids],
          includeCurrentUser: inner.value.includeCurrentUser,
          includeEmpty: inner.value.includeEmpty,
          includeActiveSprint: inner.value.includeActiveSprint,
        },
      };
    case "text":
      return { kind: "text", text: inner.value };
    case "number":
      return { kind: "number", number: inner.value };
    case "numberRange":
      return { kind: "numberRange", min: inner.value.min, max: inner.value.max };
    case "date": {
      const date = filterDateFromProto(inner.value);
      return date ? { kind: "date", date } : null;
    }
    case "dateRange": {
      const start = filterDateFromProto(inner.value.start);
      const end = filterDateFromProto(inner.value.end);
      return start && end ? { kind: "dateRange", start, end } : null;
    }
    case "flag":
      return { kind: "flag", flag: inner.value };
    default:
      return null;
  }
}

// A condition this client cannot represent is dropped rather than widened into a looser filter.
function conditionFromProto(condition: ProtoTaskFilterCondition): ViewFilterCondition | null {
  const field = fieldRefFromProto(condition.field);
  if (!field || TaskFilterOperator[condition.operator] === undefined) return null;
  if (!condition.value) return { field, operator: condition.operator, value: null };
  const value = filterValueFromProto(condition.value);
  return value ? { field, operator: condition.operator, value } : null;
}

function filterNodeFromProto(node: ProtoTaskFilterNode): ViewFilterNode | null {
  switch (node.node.case) {
    case "condition": {
      const condition = conditionFromProto(node.node.value);
      return condition ? { kind: "condition", condition } : null;
    }
    case "group":
      return { kind: "group", group: filterGroupFromProto(node.node.value) };
    default:
      return null;
  }
}

function filterGroupFromProto(group: ProtoTaskFilterGroup): ViewFilterGroup {
  return {
    logic: group.logic,
    nodes: group.nodes.map(filterNodeFromProto).filter(isPresent),
  };
}

function layoutFromProto(layout: ProtoViewDefinition["layout"]): ViewLayout {
  switch (layout.case) {
    case "table":
      return { type: "table", flat: layout.value.flat };
    case "board":
      return { type: "board", columnFieldId: layout.value.columnFieldId };
    case "roadmap":
      return { type: "roadmap", zoom: layout.value.zoom };
    case "backlog":
      return { type: "backlog" };
    case "graph":
      return { type: "graph", hideParentEdges: layout.value.hideParentEdges };
    case "resources":
      return { type: "resources" };
    default:
      return { type: "table", flat: false };
  }
}

export function protoViewDefinitionToFrontend(
  definition: ProtoViewDefinition | undefined,
): ViewDefinition {
  const proto = definition ?? create(ViewDefinitionSchema);
  return {
    layout: layoutFromProto(proto.layout),
    filter: proto.filter ? filterGroupFromProto(proto.filter) : null,
    sort: proto.sort
      .map((key) => {
        const field = fieldRefFromProto(key.field);
        return field ? { field, direction: key.direction } : null;
      })
      .filter(isPresent),
    groupBy: (() => {
      const field = fieldRefFromProto(proto.groupBy?.field);
      return proto.groupBy && field
        ? { field, direction: proto.groupBy.direction, hideEmpty: proto.groupBy.hideEmpty }
        : null;
    })(),
    visibleFields: proto.visibleFields.map(fieldRefFromProto).filter(isPresent),
    columnWidths: proto.columnWidths
      .map((column) => {
        const field = fieldRefFromProto(column.field);
        return field ? { field, width: column.width } : null;
      })
      .filter(isPresent),
    collapsedGroupKeys: [...proto.collapsedGroupKeys],
  };
}

export function protoViewConfigToFrontend(proto: ProtoViewConfig): ViewConfig {
  return {
    id: proto.id,
    projectId: proto.projectId,
    name: proto.name,
    type: protoViewTypeToFrontend(proto.type),
    definition: protoViewDefinitionToFrontend(proto.definition),
    ownerId: proto.ownerId,
    visibility: proto.visibility,
    sortOrder: proto.sortOrder,
    createdAt: proto.createdAt
      ? timestampDate(proto.createdAt).toISOString()
      : new Date().toISOString(),
    updatedAt: proto.updatedAt
      ? timestampDate(proto.updatedAt).toISOString()
      : new Date().toISOString(),
  };
}

function fieldRefToProto(ref: ViewFieldRef): FieldRefInit {
  return ref.kind === "field"
    ? { ref: { case: "fieldId", value: ref.fieldId } }
    : { ref: { case: "pseudo", value: ref.pseudo } };
}

function filterDateToProto(date: ViewFilterDate): FilterDateInit {
  return date.kind === "fixed"
    ? { value: { case: "fixed", value: date.date } }
    : {
        value: {
          case: "relative",
          value: { anchor: date.anchor, offsetDays: date.offsetDays },
        },
      };
}

function filterValueToProto(value: ViewFilterValue): FilterValueInit {
  switch (value.kind) {
    case "ids":
      return { value: { case: "ids", value: { ...value.ids, ids: [...value.ids.ids] } } };
    case "text":
      return { value: { case: "text", value: value.text } };
    case "number":
      return { value: { case: "number", value: value.number } };
    case "numberRange":
      return { value: { case: "numberRange", value: { min: value.min, max: value.max } } };
    case "date":
      return { value: { case: "date", value: filterDateToProto(value.date) } };
    case "dateRange":
      return {
        value: {
          case: "dateRange",
          value: { start: filterDateToProto(value.start), end: filterDateToProto(value.end) },
        },
      };
    case "flag":
      return { value: { case: "flag", value: value.flag } };
  }
}

function filterGroupToProto(group: ViewFilterGroup): FilterGroupInit {
  return {
    logic: group.logic,
    nodes: group.nodes.map((node) =>
      node.kind === "group"
        ? { node: { case: "group", value: filterGroupToProto(node.group) } }
        : {
            node: {
              case: "condition",
              value: {
                field: fieldRefToProto(node.condition.field),
                operator: node.condition.operator,
                value: node.condition.value ? filterValueToProto(node.condition.value) : undefined,
              },
            },
          },
    ),
  };
}

function layoutToProto(layout: ViewLayout): LayoutInit {
  switch (layout.type) {
    case "table":
      return { case: "table", value: { flat: layout.flat } };
    case "board":
      return { case: "board", value: { columnFieldId: layout.columnFieldId } };
    case "roadmap":
      return { case: "roadmap", value: { zoom: layout.zoom } };
    case "backlog":
      return { case: "backlog", value: {} };
    case "graph":
      return { case: "graph", value: { hideParentEdges: layout.hideParentEdges } };
    case "resources":
      return { case: "resources", value: {} };
  }
}

export function frontendViewDefinitionToProto(definition: ViewDefinition): ProtoViewDefinition {
  return create(ViewDefinitionSchema, {
    layout: layoutToProto(definition.layout),
    filter: definition.filter ? filterGroupToProto(definition.filter) : undefined,
    sort: definition.sort.map((key) => ({
      field: fieldRefToProto(key.field),
      direction: key.direction,
    })),
    groupBy: definition.groupBy
      ? {
          field: fieldRefToProto(definition.groupBy.field),
          direction: definition.groupBy.direction,
          hideEmpty: definition.groupBy.hideEmpty,
        }
      : undefined,
    visibleFields: definition.visibleFields.map(fieldRefToProto),
    columnWidths: definition.columnWidths.map((column) => ({
      field: fieldRefToProto(column.field),
      width: column.width,
    })),
    collapsedGroupKeys: [...definition.collapsedGroupKeys],
  });
}
