import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ViewDefinitionSchema } from "@uniffy/proto/projects/v1/projects_pb";
import { tasksForView, usesTaskOutline } from "@features/projects/viewResults";
import { applyFacets, NO_FACETS, readFacets } from "@features/projects/viewFacets";
import { narrowTasks } from "@features/projects/taskFilters";
import type { SerializedTask } from "@features/projects/projectsSerializer";

describe("view task rows", () => {
  it("keeps a fresh server match when the unfiltered cache has stale status", () => {
    const old = { id: "task", status: "todo", sortOrder: 0 } as SerializedTask;
    const current = { ...old, status: "done" };
    const definition = create(ViewDefinitionSchema, {
      filter: applyFacets(undefined, {
        ...NO_FACETS,
        ids: { ...NO_FACETS.ids, status: { ...NO_FACETS.ids.status, ids: ["done"] } },
      }),
    });
    const rows = tasksForView([old], [current], definition);
    expect(narrowTasks(rows, "", readFacets(definition.filter).facets)).toEqual([current]);
  });

  it("shows children once as flat rows without expanding them under parents", () => {
    const definition = create(ViewDefinitionSchema, {
      layout: { case: "table", value: { flat: true } },
    });
    expect(usesTaskOutline(definition, false)).toBe(false);
    expect(usesTaskOutline(definition, true)).toBe(false);
  });

  it("uses outlines only for unfiltered nested tables", () => {
    const definition = create(ViewDefinitionSchema, { layout: { case: "table", value: {} } });
    expect(usesTaskOutline(definition, false)).toBe(true);
    expect(usesTaskOutline(definition, true)).toBe(false);
  });
});
