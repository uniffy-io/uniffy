import { describe, expect, it } from "vitest";
import type { SerializedTask } from "@features/projects/projectsSerializer";
import {
  buildTaskRelations,
  isTaskBlocked,
  openBlockerCount,
  parentKeyOf,
} from "@features/projects/taskRelations";

const DONE = "2026-09-01T00:00:00Z";

function task(id: string, overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    number: 1,
    sortOrder: 0,
    blockedByTaskIds: [],
    ...overrides,
  } as SerializedTask;
}

describe("task relations index", () => {
  const tasks = [
    task("parent", { number: 1 }),
    task("late", { number: 4, parentId: "parent", sortOrder: 20, completedAt: DONE }),
    task("early", { number: 3, parentId: "parent", sortOrder: 10 }),
    task("tie", { number: 2, parentId: "parent", sortOrder: 10 }),
    task("grandchild", { number: 5, parentId: "early" }),
  ];
  const relations = buildTaskRelations(tasks);

  it("lists direct children in board order", () => {
    expect(relations.childrenByParent.get("parent")?.map((t) => t.id)).toEqual([
      "tie",
      "early",
      "late",
    ]);
    expect(relations.childrenByParent.get("early")?.map((t) => t.id)).toEqual(["grandchild"]);
    expect(relations.childrenByParent.has("late")).toBe(false);
  });

  it("counts direct children and the completed ones", () => {
    expect(relations.subtaskCounts.get("parent")).toEqual({ total: 3, done: 1 });
    expect(relations.subtaskCounts.get("early")).toEqual({ total: 1, done: 0 });
  });

  it("names a loaded parent by its key", () => {
    expect(parentKeyOf(relations.byId.get("early")!, relations.byId, "OPS")).toBe("OPS-1");
    expect(parentKeyOf(relations.byId.get("parent")!, relations.byId, "OPS")).toBeNull();
    expect(parentKeyOf(task("orphan", { parentId: "gone" }), relations.byId, "OPS")).toBeNull();
  });
});

describe("blocked tasks", () => {
  const { byId } = buildTaskRelations([task("a"), task("b"), task("c", { completedAt: DONE })]);

  it("is not blocked without blockers", () => {
    expect(isTaskBlocked(task("t"), byId)).toBe(false);
  });

  it("is blocked by an open blocker", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["a"] }), byId)).toBe(true);
  });

  it("is free once every blocker is complete", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["c"] }), byId)).toBe(false);
  });

  it("ignores a blocker that is not loaded", () => {
    expect(isTaskBlocked(task("t", { blockedByTaskIds: ["gone"] }), byId)).toBe(false);
  });

  it("is never blocked once complete", () => {
    const done = task("t", { blockedByTaskIds: ["a"], completedAt: DONE });
    expect(openBlockerCount(done, byId)).toBe(0);
  });

  it("counts only the open loaded blockers", () => {
    const mixed = task("t", { blockedByTaskIds: ["a", "b", "c", "gone"] });
    expect(openBlockerCount(mixed, byId)).toBe(2);
  });
});
