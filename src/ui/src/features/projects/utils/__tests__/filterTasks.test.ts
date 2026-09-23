import { describe, expect, it } from "vitest";
import { RelativeDateAnchor } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewFilterDate } from "@/features/projects/types/views";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import { buildTaskHierarchyIndex, resolveFilterDate } from "@/features/projects/utils/filterTasks";

// The filter semantics themselves are pinned by viewConformance.test.ts, shared with the server.

describe("resolveFilterDate", () => {
  const ctx = { today: "2026-09-23", weekStartsOn: 1 as const };
  const relative = (anchor: RelativeDateAnchor, offsetDays = 0): ViewFilterDate => ({
    kind: "relative",
    anchor,
    offsetDays,
  });

  it("anchors weeks on the preferred first day", () => {
    const start = relative(RelativeDateAnchor.START_OF_WEEK);
    expect(resolveFilterDate(start, ctx)).toBe("2026-09-21");
    expect(resolveFilterDate(start, { ...ctx, weekStartsOn: 0 })).toBe("2026-09-20");
  });

  it("resolves month ends and offsets", () => {
    expect(resolveFilterDate(relative(RelativeDateAnchor.END_OF_MONTH, 1), ctx)).toBe("2026-10-01");
    expect(resolveFilterDate(relative(RelativeDateAnchor.START_OF_MONTH, -1), ctx)).toBe(
      "2026-08-31",
    );
  });
});

describe("buildTaskHierarchyIndex", () => {
  it("computes depth and ancestors", () => {
    const index = buildTaskHierarchyIndex([
      makeTask({ id: "epic" }),
      makeTask({ id: "story", parentId: "epic" }),
      makeTask({ id: "task-a", parentId: "story" }),
      makeTask({ id: "loose" }),
    ]);
    expect(index.depthById.get("epic")).toBe(0);
    expect(index.depthById.get("task-a")).toBe(2);
    expect([...(index.ancestorIdsById.get("task-a") ?? [])].sort()).toEqual(["epic", "story"]);
    expect(index.hasChildren.has("story")).toBe(true);
    expect(index.hasChildren.has("loose")).toBe(false);
  });

  it("tolerates a cyclic parent_id chain without spinning", () => {
    const tasks = [makeTask({ id: "a", parentId: "b" }), makeTask({ id: "b", parentId: "a" })];
    const index = buildTaskHierarchyIndex(tasks);
    expect(index.depthById.get("a")).toBeLessThan(64);
    expect(index.depthById.get("b")).toBeLessThan(64);
  });
});
