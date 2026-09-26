import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FilterLogic,
  TaskFilterGroupSchema,
  TaskFilterOperator as Op,
  ViewDefinitionSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { TaskFilterGroup, TaskFilterNode } from "@uniffy/proto/projects/v1/projects_pb";
import {
  activeFacetCount,
  applyFacets,
  clearAdvanced,
  NO_FACETS,
  readFacets,
  toggleFlag,
  toggleId,
} from "@features/projects/viewFacets";
import type { TaskFacets } from "@features/projects/viewFacets";
import { definitionsEqual, fieldRef } from "@features/projects/viewDefinition";

function withIds(facets: TaskFacets, facet: keyof TaskFacets["ids"], ids: string[]): TaskFacets {
  return { ...facets, ids: { ...facets.ids, [facet]: { ...facets.ids[facet], ids } } };
}

/** A condition the sheet does not offer: title contains "api". */
function titleContains(text: string): TaskFilterNode {
  return {
    $typeName: "projects.v1.TaskFilterNode",
    node: {
      case: "condition",
      value: {
        $typeName: "projects.v1.TaskFilterCondition",
        field: fieldRef("field_title"),
        operator: Op.CONTAINS,
        value: { $typeName: "projects.v1.TaskFilterValue", value: { case: "text", value: text } },
      },
    },
  };
}

function orGroup(nodes: TaskFilterNode[]): TaskFilterGroup {
  return create(TaskFilterGroupSchema, { logic: FilterLogic.OR, nodes });
}

describe("view facets", () => {
  it("round-trips every facet through the filter tree", () => {
    let facets = withIds(NO_FACETS, "status", ["status_todo", "status_doing"]);
    facets = withIds(facets, "tags", ["tag-1"]);
    facets = {
      ...facets,
      ids: {
        ...facets.ids,
        assignee: toggleFlag(toggleFlag(facets.ids.assignee, "me"), "empty"),
        creator: toggleFlag(facets.ids.creator, "me"),
        sprint: toggleFlag(toggleId(facets.ids.sprint, "sprint-1"), "active"),
      },
      due: "thisWeek",
      milestone: true,
    };

    const { facets: read, advancedCount } = readFacets(applyFacets(undefined, facets));

    expect(advancedCount).toBe(0);
    expect(read).toEqual(facets);
    expect(activeFacetCount(read)).toBe(7);
  });

  it.each(["overdue", "today", "thisWeek", "next7Days", "none"] as const)(
    "reads the %s due preset back",
    (due) => {
      expect(readFacets(applyFacets(undefined, { ...NO_FACETS, due })).facets.due).toBe(due);
    },
  );

  it("writes overdue as due before today and not completed", () => {
    const filter = applyFacets(undefined, { ...NO_FACETS, due: "overdue" })!;
    const node = filter.nodes[0].node;
    expect(node.case).toBe("group");
    if (node.case !== "group") return;
    expect(
      node.value.nodes.map((n) => n.node.case === "condition" && n.node.value.operator),
    ).toEqual([Op.BEFORE, Op.IS_EMPTY]);
  });

  it("keeps conditions the sheet cannot show, in place, when a facet changes", () => {
    const base = applyFacets(undefined, withIds(NO_FACETS, "status", ["status_todo"]))!;
    const filter = create(TaskFilterGroupSchema, {
      logic: FilterLogic.AND,
      nodes: [titleContains("api"), ...base.nodes],
    });

    const reading = readFacets(filter);
    expect(reading.advancedCount).toBe(1);

    const next = applyFacets(filter, withIds(reading.facets, "status", ["status_done"]))!;
    expect(next.nodes[0]).toEqual(titleContains("api"));
    expect(readFacets(next).facets.ids.status.ids).toEqual(["status_done"]);
  });

  it("nests a top-level OR so a facet narrows instead of widening", () => {
    const filter = orGroup([titleContains("api"), titleContains("sync")]);
    expect(readFacets(filter)).toEqual({ facets: NO_FACETS, advancedCount: 1 });

    const next = applyFacets(filter, { ...NO_FACETS, milestone: true })!;
    expect(next.logic).toBe(FilterLogic.AND);
    expect(next.nodes[0].node.case).toBe("group");
    expect(readFacets(next)).toEqual({
      facets: { ...NO_FACETS, milestone: true },
      advancedCount: 1,
    });
  });

  it("counts a second condition on the same field as advanced", () => {
    const one = applyFacets(undefined, withIds(NO_FACETS, "priority", ["priority_high"]))!;
    const two = create(TaskFilterGroupSchema, {
      logic: FilterLogic.AND,
      nodes: [...one.nodes, ...one.nodes],
    });
    expect(readFacets(two).advancedCount).toBe(1);
  });

  it("does not take an operator it cannot show as a facet", () => {
    const filter = applyFacets(undefined, withIds(NO_FACETS, "status", ["status_todo"]))!;
    const node = filter.nodes[0].node;
    if (node.case === "condition") node.value.operator = Op.IS_NONE_OF;
    expect(readFacets(filter)).toEqual({ facets: NO_FACETS, advancedCount: 1 });
  });

  it("clears the advanced part and keeps the facets", () => {
    const base = applyFacets(undefined, { ...NO_FACETS, milestone: true })!;
    const filter = create(TaskFilterGroupSchema, {
      logic: FilterLogic.AND,
      nodes: [titleContains("api"), ...base.nodes],
    });
    expect(readFacets(clearAdvanced(filter))).toEqual({
      facets: { ...NO_FACETS, milestone: true },
      advancedCount: 0,
    });
    expect(clearAdvanced(orGroup([titleContains("a"), titleContains("b")]))).toBeUndefined();
  });

  it("removes the filter when the last facet is cleared", () => {
    const filter = applyFacets(undefined, withIds(NO_FACETS, "tags", ["tag-1"]));
    expect(applyFacets(filter, NO_FACETS)).toBeUndefined();
  });

  it("treats a reordered tree as the same view", () => {
    let facets = withIds(NO_FACETS, "status", ["b", "a"]);
    facets = { ...facets, milestone: true };
    const first = applyFacets(undefined, facets)!;
    const reordered = create(TaskFilterGroupSchema, {
      logic: FilterLogic.AND,
      nodes: [...first.nodes].reverse(),
    });
    const flipped = applyFacets(reordered, withIds(facets, "status", ["a", "b"]));
    expect(
      definitionsEqual(
        create(ViewDefinitionSchema, { filter: first }),
        create(ViewDefinitionSchema, { filter: flipped }),
      ),
    ).toBe(true);
  });
});
