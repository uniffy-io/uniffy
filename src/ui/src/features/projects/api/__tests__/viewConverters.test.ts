import { describe, expect, it } from "vitest";
import { create, equals } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  FilterLogic,
  RelativeDateAnchor,
  RoadmapZoom,
  SortDirection,
  TaskFilterOperator,
  TaskPseudoField,
  ViewConfigSchema,
  ViewDefinitionSchema,
  ViewType,
  ViewVisibility,
} from "@uniffy/proto/projects/v1/projects_pb";
import {
  frontendViewDefinitionToProto,
  protoViewConfigToFrontend,
  protoViewDefinitionToFrontend,
  protoViewTypeToFrontend,
} from "@/features/projects/api/viewConverters";

const fullDefinition = create(ViewDefinitionSchema, {
  layout: { case: "board", value: { columnFieldId: "field_priority" } },
  filter: {
    logic: FilterLogic.AND,
    nodes: [
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "fieldId", value: "field_status" } },
            operator: TaskFilterOperator.IS_ANY_OF,
            value: {
              value: {
                case: "ids",
                value: { ids: ["status_todo"], includeEmpty: true },
              },
            },
          },
        },
      },
      {
        node: {
          case: "group",
          value: {
            logic: FilterLogic.OR,
            nodes: [
              {
                node: {
                  case: "condition",
                  value: {
                    field: { ref: { case: "fieldId", value: "field_assignee" } },
                    operator: TaskFilterOperator.IS_ANY_OF,
                    value: { value: { case: "ids", value: { includeCurrentUser: true } } },
                  },
                },
              },
              {
                node: {
                  case: "condition",
                  value: {
                    field: { ref: { case: "pseudo", value: TaskPseudoField.CREATED_AT } },
                    operator: TaskFilterOperator.BETWEEN,
                    value: {
                      value: {
                        case: "dateRange",
                        value: {
                          start: { value: { case: "fixed", value: "2026-09-01" } },
                          end: {
                            value: {
                              case: "relative",
                              value: { anchor: RelativeDateAnchor.END_OF_WEEK, offsetDays: 7 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "fieldId", value: "field_points" } },
            operator: TaskFilterOperator.BETWEEN,
            value: { value: { case: "numberRange", value: { min: 1, max: 8 } } },
          },
        },
      },
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "fieldId", value: "field_points" } },
            operator: TaskFilterOperator.GREATER_THAN,
            value: { value: { case: "number", value: 3 } },
          },
        },
      },
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "fieldId", value: "field_title" } },
            operator: TaskFilterOperator.CONTAINS,
            value: { value: { case: "text", value: "login" } },
          },
        },
      },
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "pseudo", value: TaskPseudoField.IS_BLOCKED } },
            operator: TaskFilterOperator.IS,
            value: { value: { case: "flag", value: true } },
          },
        },
      },
      {
        node: {
          case: "condition",
          value: {
            field: { ref: { case: "fieldId", value: "field_due_date" } },
            operator: TaskFilterOperator.IS_EMPTY,
          },
        },
      },
    ],
  },
  sort: [
    {
      field: { ref: { case: "fieldId", value: "field_due_date" } },
      direction: SortDirection.DESC,
    },
  ],
  groupBy: {
    field: { ref: { case: "pseudo", value: TaskPseudoField.TAGS } },
    direction: SortDirection.ASC,
    hideEmpty: true,
  },
  visibleFields: [
    { ref: { case: "fieldId", value: "field_title" } },
    { ref: { case: "pseudo", value: TaskPseudoField.NUMBER } },
  ],
  columnWidths: [{ field: { ref: { case: "fieldId", value: "field_title" } }, width: 320 }],
  collapsedGroupKeys: ["untagged"],
});

describe("view definition conversion", () => {
  it("round-trips every value kind, nesting, sort, grouping and columns", () => {
    const frontend = protoViewDefinitionToFrontend(fullDefinition);

    expect(
      equals(ViewDefinitionSchema, frontendViewDefinitionToProto(frontend), fullDefinition),
    ).toBe(true);
    expect(frontend.layout).toEqual({ type: "board", columnFieldId: "field_priority" });
    expect(frontend.groupBy).toEqual({
      field: { kind: "pseudo", pseudo: TaskPseudoField.TAGS },
      direction: SortDirection.ASC,
      hideEmpty: true,
    });
  });

  it.each([
    [
      { case: "table" as const, value: { flat: true } },
      { type: "table", flat: true },
    ],
    [
      { case: "roadmap" as const, value: { zoom: RoadmapZoom.MONTH } },
      { type: "roadmap", zoom: RoadmapZoom.MONTH },
    ],
    [{ case: "backlog" as const, value: {} }, { type: "backlog" }],
    [
      { case: "graph" as const, value: { hideParentEdges: true } },
      { type: "graph", hideParentEdges: true },
    ],
    [{ case: "resources" as const, value: {} }, { type: "resources" }],
  ])("keeps the %o layout", (layout, expected) => {
    const proto = create(ViewDefinitionSchema, { layout });
    const frontend = protoViewDefinitionToFrontend(proto);

    expect(frontend.layout).toEqual(expected);
    expect(equals(ViewDefinitionSchema, frontendViewDefinitionToProto(frontend), proto)).toBe(true);
  });

  it("falls back to a table when the layout is missing", () => {
    expect(protoViewDefinitionToFrontend(undefined).layout).toEqual({ type: "table", flat: false });
    expect(protoViewDefinitionToFrontend(create(ViewDefinitionSchema)).filter).toBeNull();
  });

  it("drops conditions it cannot represent instead of loosening them", () => {
    const proto = create(ViewDefinitionSchema, {
      layout: { case: "table", value: {} },
      filter: {
        logic: FilterLogic.AND,
        nodes: [
          {
            node: {
              case: "condition",
              value: {
                field: { ref: { case: "fieldId", value: "field_status" } },
                operator: 99 as TaskFilterOperator,
              },
            },
          },
          {
            node: {
              case: "condition",
              value: { operator: TaskFilterOperator.IS_EMPTY },
            },
          },
          {
            node: {
              case: "condition",
              value: {
                field: { ref: { case: "fieldId", value: "field_due_date" } },
                operator: TaskFilterOperator.BEFORE,
                value: { value: { case: "date", value: {} } },
              },
            },
          },
          {
            node: {
              case: "condition",
              value: {
                field: { ref: { case: "fieldId", value: "field_title" } },
                operator: TaskFilterOperator.IS_NOT_EMPTY,
              },
            },
          },
        ],
      },
    });

    expect(protoViewDefinitionToFrontend(proto).filter?.nodes).toEqual([
      {
        kind: "condition",
        condition: {
          field: { kind: "field", fieldId: "field_title" },
          operator: TaskFilterOperator.IS_NOT_EMPTY,
          value: null,
        },
      },
    ]);
  });
});

describe("view config conversion", () => {
  it("maps every view type", () => {
    expect(
      [
        ViewType.TABLE,
        ViewType.BOARD,
        ViewType.ROADMAP,
        ViewType.BACKLOG,
        ViewType.GRAPH,
        ViewType.RESOURCES,
        ViewType.UNSPECIFIED,
      ].map(protoViewTypeToFrontend),
    ).toEqual(["table", "board", "roadmap", "backlog", "graph", "resources", "table"]);
  });

  it("carries ownership, visibility and order", () => {
    const created = new Date("2026-09-17T10:00:00Z");
    const view = protoViewConfigToFrontend(
      create(ViewConfigSchema, {
        id: "view_abc",
        projectId: "proj-1",
        name: "My bugs",
        type: ViewType.BOARD,
        definition: fullDefinition,
        ownerId: "user-1",
        visibility: ViewVisibility.PERSONAL,
        sortOrder: 3,
        createdAt: timestampFromDate(created),
        updatedAt: timestampFromDate(created),
      }),
    );

    expect(view).toMatchObject({
      id: "view_abc",
      type: "board",
      ownerId: "user-1",
      visibility: ViewVisibility.PERSONAL,
      sortOrder: 3,
      createdAt: created.toISOString(),
    });
    expect(view.definition.layout.type).toBe("board");
  });
});
