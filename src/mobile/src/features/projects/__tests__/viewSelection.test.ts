import { expect, it } from "vitest";
import { resolveProjectView } from "@features/projects/viewSelection";
import type { SerializedView } from "@features/projects/projectsSerializer";

it("opens a usable table when every visible saved view has been deleted", () => {
  const view = resolveProjectView([], ["deleted", undefined]);
  expect(view.layout).toBe("table");
  expect(view.definition.layout.case).toBe("table");
  expect(view.definition.filter).toBeUndefined();
  expect(view.ownerId).toBe("");
});

it("prefers valid explicit selection, then link, remembered view and default", () => {
  const linked = { id: "link" } as SerializedView;
  const picked = { id: "picked" } as SerializedView;
  expect(resolveProjectView([linked, picked], ["picked", "link"])).toBe(picked);
  expect(resolveProjectView([linked, picked], ["deleted", "link"])).toBe(linked);
  expect(resolveProjectView([linked, picked], [])).toBe(linked);
});
