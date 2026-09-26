import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  SortDirection,
  TaskPseudoField,
  ViewDefinitionSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import { fieldRef, pseudoRef, viewQueryDefinition } from "@features/projects/viewDefinition";

describe("view query definition", () => {
  it("skips deleted sort fields while preserving remaining priority and the saved definition", () => {
    const saved = create(ViewDefinitionSchema, {
      sort: [
        { field: fieldRef("removed"), direction: SortDirection.ASC },
        { field: fieldRef("existing"), direction: SortDirection.DESC },
        { field: pseudoRef(TaskPseudoField.CREATED_AT), direction: SortDirection.ASC },
      ],
    });
    const request = viewQueryDefinition(saved, [{ id: "existing" }]);
    expect(request.sort).toEqual(saved.sort.slice(1));
    expect(saved.sort).toHaveLength(3);
  });

  it("falls back to manual order when every sort field has been deleted", () => {
    const saved = create(ViewDefinitionSchema, {
      sort: [{ field: fieldRef("removed"), direction: SortDirection.ASC }],
    });
    expect(viewQueryDefinition(saved, []).sort).toEqual([]);
    expect(saved.sort).toHaveLength(1);
  });
});
