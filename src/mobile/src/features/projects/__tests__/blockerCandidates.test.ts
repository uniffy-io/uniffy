import { describe, expect, it } from "vitest";
import type { SerializedTask } from "@features/projects/projectsSerializer";
import { rankBlockerCandidates } from "@features/projects/blockerCandidates";

function task(id: string, overrides: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    title: `Task ${id}`,
    number: 1,
    sortOrder: 0,
    taskType: "task",
    blockedByTaskIds: [],
    ...overrides,
  } as SerializedTask;
}

const tasks = [
  task("epic", { title: "Checkout", taskType: "epic", number: 1 }),
  task("story", { title: "Payments", parentId: "epic", number: 2 }),
  task("a", { title: "Card form", parentId: "epic", number: 3 }),
  task("b", { title: "Card validation", parentId: "epic", number: 4 }),
  task("c", { title: "Card styles", parentId: "epic", number: 5, completedAt: "2026-10-01" }),
  task("d", { title: "Retries", parentId: "story", number: 6 }),
  task("e", { title: "Dashboard", number: 7, updatedAt: "2026-10-30T00:00:00Z" }),
];
const current = tasks[2];

function ids(query = "", excludeIds: string[] = []) {
  return rankBlockerCandidates(current, tasks, { query, excludeIds }).map((s) => ({
    key: s.key,
    ids: s.tasks.map((t) => t.id),
  }));
}

describe("rankBlockerCandidates", () => {
  it("groups siblings, then the same epic, then the rest, done last", () => {
    expect(ids()).toEqual([
      { key: "siblings", ids: ["story", "b", "c"] },
      { key: "epic", ids: ["d"] },
      { key: "recent", ids: ["e", "epic"] },
    ]);
  });

  it("matches a bare number as the task number", () => {
    expect(ids("6")).toEqual([{ key: "epic", ids: ["d"] }]);
  });

  it("keeps excluded ids and the task itself out", () => {
    const all = ids("", ["b"]).flatMap((s) => s.ids);
    expect(all).not.toContain("a");
    expect(all).not.toContain("b");
  });
});
