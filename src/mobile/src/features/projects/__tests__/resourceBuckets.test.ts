import { describe, expect, it } from "vitest";
import type { SerializedTask } from "@features/projects/projectsSerializer";
import { buildResourceBuckets, UNASSIGNED } from "@features/projects/resourceBuckets";

function task(id: string, overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    assigneeIds: [],
    dueDate: null,
    ...overrides,
  } as SerializedTask;
}

describe("resource buckets", () => {
  const tasks = [
    task("root-open", { assigneeIds: ["ann"], dueDate: "2020-01-01", estimatedMinutes: 60 }),
    task("root-done", {
      assigneeIds: ["ann"],
      dueDate: "2020-01-01",
      completedAt: "2020-01-02T00:00:00Z",
      timeSpentMinutes: 30,
    }),
    task("sub-for-bob", { parentId: "root-open", assigneeIds: ["bob"] }),
    task("sub-for-ann", { parentId: "root-open", assigneeIds: ["ann"], estimatedMinutes: 500 }),
    task("loose"),
    task("shared", { assigneeIds: ["cat", "ann"] }),
  ];
  const buckets = buildResourceBuckets(tasks);

  it("gives no row to someone assigned only to subtasks", () => {
    expect(buckets.map((b) => b.subjectId)).not.toContain("bob");
  });

  it("counts top-level work only, overdue only while open", () => {
    expect(buckets.find((b) => b.subjectId === "ann")).toEqual({
      subjectId: "ann",
      open: 2,
      done: 1,
      overdue: 1,
      estimated: 60,
      spent: 30,
    });
  });

  it("lists the busiest first and unassigned last", () => {
    expect(buckets.map((b) => b.subjectId)).toEqual(["ann", "cat", UNASSIGNED]);
  });
});
