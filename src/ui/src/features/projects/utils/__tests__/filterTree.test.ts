import { describe, expect, it } from "vitest";
import {
  FilterLogic,
  RelativeDateAnchor,
  TaskFilterOperator as Op,
  TaskPseudoField as Pseudo,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { FieldDefinition } from "@/features/projects/types";
import type {
  ViewCatalog,
  ViewFilterCondition,
  ViewFilterGroup,
  ViewFilterLimits,
} from "@/features/projects/types/views";
import {
  NO_ID_SET,
  appendChild,
  appendNarrowing,
  conditionProblem,
  countNodes,
  describeCondition,
  describeDate,
  describeNode,
  editorGroup,
  fromEditorTree,
  hasFilterProblems,
  isConditionComplete,
  isOverdueGroup,
  presetNode,
  removeNode,
  toEditorTree,
  withPreset,
  type FilterLabels,
} from "@/features/projects/utils/filterTree";
import { resolveFilterDate } from "@/features/projects/utils/filterTasks";
import { capabilitiesOf, fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";

const LIMITS: ViewFilterLimits = {
  maxDepth: 3,
  maxNodes: 50,
  maxIdsPerCondition: 100,
  maxTextLength: 500,
  maxRelativeOffsetDays: 3660,
};

function field(id: string, type: FieldDefinition["type"], options: string[] = []): FieldDefinition {
  return {
    id,
    projectId: "proj-1",
    name: id === "field_assignee" ? "Assignee" : id === "field_due_date" ? "Due" : id,
    type,
    isRequired: false,
    isSystem: id.startsWith("field_"),
    sortOrder: 0,
    config: {
      options: options.map((option, order) => ({
        id: option,
        label: option.toUpperCase(),
        color: "",
        sortOrder: order,
      })),
    },
    createdAt: "",
    updatedAt: "",
  };
}

const FIELDS = new Map(
  [
    field("field_status", "single_select", ["todo", "done"]),
    field("field_assignee", "person"),
    field("field_due_date", "date"),
    field("points", "number"),
  ].map((entry) => [entry.id, entry]),
);

const LABELS: FilterLabels = {
  field: (ref) =>
    ref.kind === "field"
      ? (FIELDS.get(ref.fieldId)?.name ?? "Deleted field")
      : ref.pseudo === Pseudo.COMPLETED_AT
        ? "Completed"
        : ref.pseudo === Pseudo.SPRINT
          ? "Sprint"
          : ref.pseudo === Pseudo.TAGS
            ? "Tags"
            : "Attribute",
  value: (_ref, _kind, id) => ({ u1: "Ann", u2: "Bo", todo: "To do", done: "Done" })[id] ?? id,
  date: (date) => `on ${date}`,
};

function statusIs(...ids: string[]): ViewFilterCondition {
  return {
    field: fieldRef("field_status"),
    operator: Op.IS_ANY_OF,
    value: { kind: "ids", ids: { ...NO_ID_SET, ids } },
  };
}

describe("editor tree", () => {
  it("round-trips nested groups and drops rows the server would refuse", () => {
    const filter: ViewFilterGroup = {
      logic: FilterLogic.AND,
      nodes: [
        { kind: "condition", condition: statusIs("todo") },
        {
          kind: "group",
          group: {
            logic: FilterLogic.OR,
            nodes: [
              { kind: "condition", condition: statusIs("done") },
              { kind: "condition", condition: statusIs() },
            ],
          },
        },
      ],
    };
    const root = toEditorTree(filter);
    expect(countNodes(root)).toBe(4);
    expect(fromEditorTree(root, LIMITS)).toEqual({
      logic: FilterLogic.AND,
      nodes: [
        { kind: "condition", condition: statusIs("todo") },
        {
          kind: "group",
          group: {
            logic: FilterLogic.OR,
            nodes: [{ kind: "condition", condition: statusIs("done") }],
          },
        },
      ],
    });
  });

  it("drops empty groups and returns null for an empty tree", () => {
    const root = editorGroup(FilterLogic.AND, [editorGroup(FilterLogic.OR)]);
    expect(fromEditorTree(root, LIMITS)).toBeNull();
  });

  it("adds into and removes from a nested group by id", () => {
    const inner = editorGroup(FilterLogic.OR);
    let root = editorGroup(FilterLogic.AND, [inner]);
    root = appendChild(root, inner.id, { id: "c1", kind: "condition", condition: statusIs("x") });
    expect(countNodes(root)).toBe(2);
    root = removeNode(root, "c1");
    expect(countNodes(root)).toBe(1);
  });

  it("wraps an OR tree before adding so the addition narrows", () => {
    const root = toEditorTree({
      logic: FilterLogic.OR,
      nodes: [
        { kind: "condition", condition: statusIs("todo") },
        { kind: "condition", condition: statusIs("done") },
      ],
    });
    const next = appendNarrowing(root, { id: "n", kind: "condition", condition: statusIs("x") });
    expect(next.logic).toBe(FilterLogic.AND);
    expect(next.children).toHaveLength(2);
    expect(next.children[0].kind === "group" && next.children[0].logic).toBe(FilterLogic.OR);
  });
});

describe("isConditionComplete", () => {
  it("needs exactly one value for is and is not", () => {
    const one = { ...statusIs("todo"), operator: Op.IS };
    const two = { ...statusIs("todo", "done"), operator: Op.IS };
    expect(isConditionComplete(one, LIMITS)).toBe(true);
    expect(isConditionComplete(two, LIMITS)).toBe(false);
  });

  it("refuses is all of with the empty flag, as the server does", () => {
    const condition: ViewFilterCondition = {
      field: fieldRef("field_assignee"),
      operator: Op.IS_ALL_OF,
      value: { kind: "ids", ids: { ...NO_ID_SET, ids: ["u1"], includeEmpty: true } },
    };
    expect(isConditionComplete(condition, LIMITS)).toBe(false);
  });

  it("holds text, ids and offsets to the catalog limits", () => {
    const text: ViewFilterCondition = {
      field: fieldRef("field_title"),
      operator: Op.CONTAINS,
      value: { kind: "text", text: "x".repeat(501) },
    };
    expect(isConditionComplete(text, LIMITS)).toBe(false);
    const far: ViewFilterCondition = {
      field: fieldRef("field_due_date"),
      operator: Op.IS,
      value: {
        kind: "date",
        date: { kind: "relative", anchor: RelativeDateAnchor.TODAY, offsetDays: 4000 },
      },
    };
    expect(isConditionComplete(far, LIMITS)).toBe(false);
  });

  it("takes no value for the emptiness operators", () => {
    const empty: ViewFilterCondition = {
      field: fieldRef("field_assignee"),
      operator: Op.IS_EMPTY,
      value: null,
    };
    expect(isConditionComplete(empty, LIMITS)).toBe(true);
  });
});

describe("problems", () => {
  it("flags a deleted field and a deleted option, nested or not", () => {
    const deleted: ViewFilterCondition = { ...statusIs("todo"), field: fieldRef("gone") };
    expect(conditionProblem(deleted, FIELDS)).toMatch(/deleted/);
    expect(conditionProblem(statusIs("archived"), FIELDS)).toMatch(/option/);
    expect(conditionProblem(statusIs("todo"), FIELDS)).toBeNull();
    const nested: ViewFilterGroup = {
      logic: FilterLogic.AND,
      nodes: [
        {
          kind: "group",
          group: { logic: FilterLogic.OR, nodes: [{ kind: "condition", condition: deleted }] },
        },
      ],
    };
    expect(hasFilterProblems(nested, FIELDS)).toBe(true);
    expect(hasFilterProblems(null, FIELDS)).toBe(false);
  });
});

describe("presets", () => {
  it("writes overdue as the group mobile reads: due before today and not completed", () => {
    const node = presetNode("overdue");
    expect(node.kind).toBe("group");
    if (node.kind === "group") expect(isOverdueGroup(node.group)).toBe(true);
    expect(describeNode(node, FIELDS, LABELS)).toBe("Overdue");
  });

  it("reads each preset back as a sentence", () => {
    const read = (preset: Parameters<typeof presetNode>[0]) =>
      describeNode(presetNode(preset), FIELDS, LABELS);
    expect(read("myTasks")).toBe("Assignee is me");
    expect(read("unassigned")).toBe("Assignee is unassigned");
    expect(read("dueThisWeek")).toBe("Due this week");
    expect(read("completedWeek")).toBe("Completed in the last 7 days");
  });

  it("adds a preset to the tree the builder is editing", () => {
    const root = withPreset(toEditorTree(null), "myTasks");
    expect(fromEditorTree(root, LIMITS)?.nodes).toEqual([presetNode("myTasks")]);
  });
});

describe("chip sentences", () => {
  const say = (condition: ViewFilterCondition) => describeCondition(condition, FIELDS, LABELS);

  it("joins values with or, and all of with and", () => {
    expect(say(statusIs("todo", "done"))).toBe("field_status is To do or Done");
    expect(say({ ...statusIs("todo"), operator: Op.IS_NONE_OF })).toBe("field_status is not To do");
    expect(
      say({
        field: fieldRef("field_assignee"),
        operator: Op.IS_ALL_OF,
        value: { kind: "ids", ids: { ...NO_ID_SET, ids: ["u1", "u2"] } },
      }),
    ).toBe("Assignee has Ann and Bo");
  });

  it("names me and the empty flag in words", () => {
    expect(
      say({
        field: fieldRef("field_assignee"),
        operator: Op.IS_ANY_OF,
        value: { kind: "ids", ids: { ...NO_ID_SET, includeCurrentUser: true, includeEmpty: true } },
      }),
    ).toBe("Assignee is me or unassigned");
    expect(
      say({
        field: pseudoRef(Pseudo.SPRINT),
        operator: Op.IS_ANY_OF,
        value: {
          kind: "ids",
          ids: { ...NO_ID_SET, includeActiveSprint: true, includeEmpty: true },
        },
      }),
    ).toBe("Sprint is the active sprint or the backlog");
  });

  it("reads dates, numbers and booleans", () => {
    expect(
      say({
        field: fieldRef("field_due_date"),
        operator: Op.BEFORE,
        value: {
          kind: "date",
          date: { kind: "relative", anchor: RelativeDateAnchor.END_OF_WEEK, offsetDays: 0 },
        },
      }),
    ).toBe("Due before the end of the week");
    expect(
      say({
        field: fieldRef("points"),
        operator: Op.BETWEEN,
        value: { kind: "numberRange", min: 1, max: 3 },
      }),
    ).toBe("points is between 1 and 3");
    expect(
      say({
        field: pseudoRef(Pseudo.IS_BLOCKED),
        operator: Op.IS,
        value: { kind: "flag", flag: false },
      }),
    ).toBe("Not blocked");
    expect(
      say({
        field: pseudoRef(Pseudo.DEPTH),
        operator: Op.IS,
        value: { kind: "number", number: 0 },
      }),
    ).toBe("Top-level only");
  });

  it("summarizes a nested group by its logic and size", () => {
    const group: ViewFilterGroup = {
      logic: FilterLogic.OR,
      nodes: [
        { kind: "condition", condition: statusIs("todo") },
        { kind: "condition", condition: statusIs("done") },
      ],
    };
    expect(describeNode({ kind: "group", group }, FIELDS, LABELS)).toBe("Any of 2 conditions");
  });

  it("marks a condition on a deleted field", () => {
    expect(say({ ...statusIs("todo"), field: fieldRef("gone") })).toBe(
      "Condition on a deleted field",
    );
  });
});

describe("relative dates", () => {
  const ctx = { today: "2026-09-30", weekStartsOn: 1 as const };

  it("words relative days the way they resolve", () => {
    const today = (offsetDays: number) =>
      ({ kind: "relative", anchor: RelativeDateAnchor.TODAY, offsetDays }) as const;
    expect(describeDate(today(-1), LABELS)).toBe("yesterday");
    expect(resolveFilterDate(today(-1), ctx)).toBe("2026-09-29");
    expect(describeDate(today(1), LABELS)).toBe("tomorrow");
    expect(resolveFilterDate(today(1), ctx)).toBe("2026-10-01");
    expect(describeDate(today(-10), LABELS)).toBe("10 days ago");
    expect(describeDate({ kind: "fixed", date: "2026-01-02" }, LABELS)).toBe("on 2026-01-02");
  });

  it("crosses month and week edges", () => {
    const endOfMonth = {
      kind: "relative",
      anchor: RelativeDateAnchor.END_OF_MONTH,
      offsetDays: 1,
    } as const;
    expect(resolveFilterDate(endOfMonth, ctx)).toBe("2026-10-01");
    expect(describeDate(endOfMonth, LABELS)).toBe("1 day after the end of the month");
    const endOfWeek = {
      kind: "relative",
      anchor: RelativeDateAnchor.END_OF_WEEK,
      offsetDays: 0,
    } as const;
    expect(resolveFilterDate(endOfWeek, ctx)).toBe("2026-10-04");
  });
});

describe("capabilitiesOf", () => {
  const catalog: ViewCatalog = {
    fieldTypes: {
      person: {
        operators: [Op.IS_ANY_OF],
        idFlags: ["includeCurrentUser"],
        sortable: true,
        groupable: true,
      },
    },
    pseudoFields: {
      [Pseudo.TAGS]: { operators: [Op.IS_ALL_OF], idFlags: [], sortable: false, groupable: true },
    },
    filterLimits: LIMITS,
  };

  it("resolves a custom field by its type and an attribute by itself", () => {
    expect(capabilitiesOf(fieldRef("field_assignee"), FIELDS, catalog)?.idFlags).toEqual([
      "includeCurrentUser",
    ]);
    expect(capabilitiesOf(pseudoRef(Pseudo.TAGS), FIELDS, catalog)?.sortable).toBe(false);
  });

  it("offers nothing for a deleted field or before the catalog loads", () => {
    expect(capabilitiesOf(fieldRef("gone"), FIELDS, catalog)).toBeNull();
    expect(capabilitiesOf(fieldRef("field_assignee"), FIELDS, null)).toBeNull();
  });
});
