import { describe, expect, it } from "vitest";
import type { RootState } from "@/app/store";
import {
  selectSprintsForProject,
  setSprintsError,
  setSprintsForProject,
  sprintsReducer,
} from "@/features/projects/store/sprintsSlice";
import type { Sprint } from "@/features/projects/types/project";

function sprint(id: string, sortOrder: number): Sprint {
  return {
    id,
    projectId: "project-1",
    organizationId: "org-1",
    name: id,
    goal: "",
    status: "planned",
    startDate: null,
    endDate: null,
    sortOrder,
    taskCount: 0,
    completedTaskCount: 0,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

const withSprints = (sprints: ReturnType<typeof sprintsReducer>) =>
  ({ sprints }) as unknown as RootState;

describe("selectSprintsForProject", () => {
  const loaded = sprintsReducer(
    undefined,
    setSprintsForProject({ projectId: "project-1", sprints: [sprint("b", 2), sprint("a", 1)] }),
  );

  it("sorts by sort order", () => {
    const result = selectSprintsForProject("project-1")(withSprints(loaded));
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("returns the same array until the sprints change", () => {
    const state = withSprints(loaded);
    const first = selectSprintsForProject("project-1")(state);
    expect(selectSprintsForProject("project-1")(state)).toBe(first);

    const unrelated = withSprints(sprintsReducer(loaded, setSprintsError("offline")));
    expect(selectSprintsForProject("project-1")(unrelated)).toBe(first);

    const changed = withSprints(
      sprintsReducer(loaded, setSprintsForProject({ projectId: "project-1", sprints: [] })),
    );
    expect(selectSprintsForProject("project-1")(changed)).toEqual([]);
  });

  it("keeps a separate result per project", () => {
    const state = withSprints(loaded);
    const empty = selectSprintsForProject("project-2")(state);
    expect(empty).toEqual([]);
    expect(selectSprintsForProject("project-1")(state)).toHaveLength(2);
    expect(selectSprintsForProject("project-2")(state)).toBe(empty);
  });
});
