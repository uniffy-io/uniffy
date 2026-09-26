import { describe, expect, it } from "vitest";
import {
  FilterLogic,
  SortDirection,
  TaskFilterOperator as Op,
  TaskPseudoField,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewFilterGroup } from "@/features/projects/types/views";
import {
  NO_SPRINT,
  definitionsEqual,
  emptyDefinition,
  removeFilterNode,
  setQuickFilter,
  summarizeFilter,
  toggleCollapsedKey,
  toggleSortKey,
  toggleVisibleField,
} from "@/features/projects/utils/viewDraft";
import { fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";

const STATUS = fieldRef("field_status");
const TITLE = fieldRef("field_title");
const PRIORITY = fieldRef("field_priority");

const builderCondition: ViewFilterGroup["nodes"][number] = {
  kind: "condition",
  condition: { field: TITLE, operator: Op.CONTAINS, value: { kind: "text", text: "login" } },
};

describe("quick filters", () => {
  it("adds each quick filter as its own top-level condition and reads it back as a chip", () => {
    let filter = setQuickFilter(null, "taskType", ["bug"]);
    filter = setQuickFilter(filter, "sprint", [NO_SPRINT]);
    filter = setQuickFilter(filter, "tags", ["red", "blue"]);
    filter = setQuickFilter(filter, "rootOnly", ["on"]);
    filter = setQuickFilter(filter, "epic", ["epic-1"]);

    const { chips, otherCount } = summarizeFilter(filter);
    expect(otherCount).toBe(0);
    expect(chips.map((chip) => [chip.kind, chip.values])).toEqual([
      ["taskType", ["bug"]],
      ["sprint", [NO_SPRINT]],
      ["tags", ["red", "blue"]],
      ["rootOnly", []],
      ["epic", ["epic-1"]],
    ]);
    expect(filter?.nodes[1]).toMatchObject({
      condition: { field: pseudoRef(TaskPseudoField.SPRINT), operator: Op.IS_EMPTY },
    });
  });

  it("replaces a quick filter in place and removes exactly one node for a chip", () => {
    let filter = setQuickFilter({ logic: FilterLogic.AND, nodes: [builderCondition] }, "taskType", [
      "bug",
    ]);
    filter = setQuickFilter(filter, "taskType", ["story"]);
    filter = setQuickFilter(filter, "sprint", ["sprint-1"]);
    expect(filter?.nodes).toHaveLength(3);

    const typeChip = summarizeFilter(filter).chips.find((chip) => chip.kind === "taskType")!;
    expect(typeChip.values).toEqual(["story"]);
    const without = removeFilterNode(filter, typeChip.index);
    expect(summarizeFilter(without).chips.map((chip) => chip.kind)).toEqual(["sprint"]);
    expect(summarizeFilter(without).otherCount).toBe(1);
  });

  it("wraps an OR tree before adding a quick filter so the view narrows", () => {
    const either: ViewFilterGroup = {
      logic: FilterLogic.OR,
      nodes: [builderCondition, builderCondition],
    };
    const filter = setQuickFilter(either, "taskType", ["bug"]);
    expect(filter?.logic).toBe(FilterLogic.AND);
    expect(filter?.nodes[0]).toEqual({ kind: "group", group: either });
    expect(summarizeFilter(filter)).toMatchObject({ otherCount: 1 });
  });
});

describe("toggleSortKey", () => {
  it("steps a plain click through ascending, descending and off", () => {
    const asc = toggleSortKey([], STATUS, false);
    expect(asc).toEqual([{ field: STATUS, direction: SortDirection.ASC }]);
    const desc = toggleSortKey(asc, STATUS, false);
    expect(desc).toEqual([{ field: STATUS, direction: SortDirection.DESC }]);
    expect(toggleSortKey(desc, STATUS, false)).toEqual([]);
  });

  it("replaces several keys on a plain click and appends on shift-click", () => {
    const two = toggleSortKey(toggleSortKey([], STATUS, false), PRIORITY, true);
    expect(two.map((key) => key.field)).toEqual([STATUS, PRIORITY]);
    expect(toggleSortKey(two, STATUS, false)).toEqual([
      { field: STATUS, direction: SortDirection.ASC },
    ]);
    const flipped = toggleSortKey(two, PRIORITY, true);
    expect(flipped[1].direction).toBe(SortDirection.DESC);
    expect(toggleSortKey(flipped, PRIORITY, true)).toEqual([two[0]]);
  });
});

describe("toggleVisibleField", () => {
  const all = [TITLE, STATUS, PRIORITY];

  it("writes out every field before hiding the first one", () => {
    expect(toggleVisibleField([], PRIORITY, all, false)).toEqual([TITLE, STATUS]);
  });

  it("shows a field again at its place in the project order", () => {
    expect(toggleVisibleField([TITLE, PRIORITY], STATUS, all, true)).toEqual([
      TITLE,
      STATUS,
      PRIORITY,
    ]);
  });
});

describe("definitionsEqual", () => {
  it("ignores key order and treats an empty filter as none", () => {
    const a = emptyDefinition("table");
    const b = {
      collapsedGroupKeys: [],
      columnWidths: [],
      visibleFields: [],
      groupBy: null,
      sort: [],
      filter: { logic: FilterLogic.AND, nodes: [] },
      layout: { flat: false, type: "table" as const },
    };
    expect(definitionsEqual(a, b)).toBe(true);
    expect(definitionsEqual(a, { ...a, collapsedGroupKeys: ["x"] })).toBe(false);
  });
});

describe("toggleCollapsedKey", () => {
  it("toggles and caps the list at what a save accepts", () => {
    expect(toggleCollapsedKey(toggleCollapsedKey([], "a"), "a")).toEqual([]);
    const full = Array.from({ length: 200 }, (_, index) => `k${index}`);
    const next = toggleCollapsedKey(full, "new");
    expect(next).toHaveLength(200);
    expect(next.at(-1)).toBe("new");
    expect(next[0]).toBe("k1");
  });
});
